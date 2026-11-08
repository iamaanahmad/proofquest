import { useCallback } from "react";
import {
  transact,
  Web3MobileWallet,
} from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { Transaction, PublicKey } from "@solana/web3.js";
import { Buffer } from "@craftzdog/react-native-buffer";
import { useWalletStore } from "../store/wallet";
import {
  connection,
  getLatestBlockhashWithFallback,
  getCurrentBlockHeight,
  questPda,
} from "../lib/solana";

export const APP_IDENTITY = {
  name: "ProofQuest",
  uri: "https://proofquest.app",
  icon: "favicon.ico",
};

/**
 * Distinct, retryable signal raised by waitForConfirmation when the tx's
 * blockhash has expired: the current block height has passed
 * lastValidBlockHeight, the signature is still not visible on-chain, AND the
 * quest PDA does not exist (so the fund never landed). The caller catches this
 * specific class to re-enter the MWA sign flow with a fresh blockhash. Every
 * other error (on-chain failure, genuine non-expiry timeout) is a plain Error
 * and must propagate unchanged.
 */
export class BlockhashExpiredError extends Error {
  constructor(msg?: string) {
    super(msg ?? "Transaction expired (blockhash no longer valid) — please try again.");
    this.name = "BlockhashExpiredError";
  }
}

export async function authorizeOrReauthorize(wallet: Web3MobileWallet): Promise<void> {
  const { authToken, setWallet } = useWalletStore.getState();
  if (authToken) {
    try {
      const result = await wallet.reauthorize({ auth_token: authToken, identity: APP_IDENTITY });
      const pk = new PublicKey(Buffer.from(result.accounts[0].address, "base64"));
      setWallet(pk, result.auth_token);
      return;
    } catch {
      // Fallback to authorize if reauthorize fails
    }
  }
  const result = await wallet.authorize({ cluster: "devnet", identity: APP_IDENTITY });
  const pk = new PublicKey(Buffer.from(result.accounts[0].address, "base64"));
  setWallet(pk, result.auth_token);
}

/**
 * Signs and sends a transaction via MWA (Phantom).
 *
 * Returns the base58 signature as soon as the wallet confirms the send.
 * Does NOT wait for on-chain confirmation — the caller is responsible for
 * that (see CreateQuestScreen's tryResumePendingQuest / AppState pattern).
 *
 * Rationale: Android can suspend the JS thread the moment Phantom opens.
 * Doing any async work (polling, confirmTransaction) inside or immediately
 * after transact() is unreliable.  We return the sig quickly so the caller
 * can persist it to AsyncStorage before the thread is frozen, allowing the
 * AppState "foreground" event to pick up and complete confirmation later.
 */
export async function signAndBroadcast(
  tx: Transaction
): Promise<{ sig: string; lastValidBlockHeight: number }> {
  const { publicKey } = useWalletStore.getState();
  if (!publicKey) throw new Error("Wallet not connected");

  tx.feePayer = publicKey;

  // CRITICAL: the blockhash MUST be fetched BEFORE entering transact(), NOT
  // inside the session callback. On Android, once Phantom foregrounds (after
  // authorize), the OS can suspend our JS thread; any awaited RPC call issued
  // inside the transact() callback then stalls, and the local-association MWA
  // WebSocket session times out before the sign call runs — Phantom never shows
  // the transaction prompt and control never returns. So we fetch here, as late
  // as possible before transact(), and keep the session callback free of any
  // awaited network call between authorize and signing.
  const { blockhash, lastValidBlockHeight } = await getLatestBlockhashWithFallback();
  tx.recentBlockhash = blockhash;

  // SIGN-ONLY via MWA, then BROADCAST from the app ourselves.
  //
  // We deliberately use signTransactions (not signAndSendTransactions): the
  // problem with letting Phantom broadcast is the delay between our pre-session
  // blockhash fetch and Phantom's actual network submission (plus the human
  // approval time) — on devnet that routinely exceeds the ~60-90s blockhash
  // lifetime, so the network drops the tx and nothing lands. By having Phantom
  // only SIGN and then broadcasting the raw signed tx ourselves via our Helius
  // RPC immediately after the session returns — in a tight retry loop with NO
  // human delay — the send happens while the blockhash is still as fresh as it
  // can be, and we control the submission/retry rather than depending on the
  // wallet's broadcast behavior.
  const signedTx = await transact(async (wallet) => {
    // Auth: silent reauthorize or full authorize (shows Phantom UI)
    await authorizeOrReauthorize(wallet);

    // Refresh feePayer in case publicKey changed during auth.
    // NO awaited network/RPC call may go here — see the comment above.
    const { publicKey: freshPk } = useWalletStore.getState();
    if (freshPk) tx.feePayer = freshPk;

    const signed = await wallet.signTransactions({ transactions: [tx] });
    return signed[0];
  });

  // Serialize once; we re-send the SAME signed bytes on every retry.
  const rawTx = signedTx.serialize();

  // Broadcast ourselves, retrying the raw send for a few seconds. sendRawTransaction
  // returns the base58 signature string directly (no bs58/Buffer dependency, so the
  // Hermes/quick-crypto Buffer-prototype issue is avoided). skipPreflight keeps the
  // submit fast; maxRetries:0 means WE own the retry cadence below.
  const SEND_ATTEMPTS = 10;
  let sig = "";
  let lastErr: any;
  for (let i = 0; i < SEND_ATTEMPTS; i++) {
    try {
      sig = await connection.sendRawTransaction(rawTx, {
        skipPreflight: true,
        maxRetries: 0,
      });
      break; // accepted by the RPC — stop re-sending
    } catch (e: any) {
      lastErr = e;
      // Transient RPC/network error — wait briefly and re-send the same bytes.
      await new Promise<void>((r) => setTimeout(() => r(), 1000));
    }
  }
  if (!sig) {
    throw lastErr ?? new Error("Failed to broadcast transaction");
  }

  return { sig, lastValidBlockHeight };
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(bytes: Uint8Array): string {
  const digits: number[] = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  // Leading zero bytes → leading '1's
  let result = "";
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) result += "1";
  for (let i = digits.length - 1; i >= 0; i--) result += BASE58_ALPHABET[digits[i]];
  return result;
}

/**
 * Poll for on-chain confirmation of a signature using HTTP (not WebSocket).
 * WebSocket subscriptions are unreliable on mobile/devnet.
 * Polls every 2 s for up to ~90 s.
 *
 * Blockheight-aware: when lastValidBlockHeight is provided, the loop detects a
 * blockhash that has expired (the network silently drops such transactions)
 * and fails fast instead of waiting out the full timeout.
 *
 * PDA fallback: when creator + questId are provided, the deterministic quest
 * PDA is checked each iteration — a non-null account means the fund succeeded
 * even if the signature status is lagging on this RPC node.
 *
 * All opts are optional for backward-compat with persisted records written
 * before these fields existed; missing fields simply disable that check.
 */
export async function waitForConfirmation(
  sig: string,
  opts?: { lastValidBlockHeight?: number; creator?: PublicKey; questId?: bigint }
): Promise<void> {
  const MAX_ATTEMPTS = 45;

  const lastValidBlockHeight = opts?.lastValidBlockHeight;
  const blockHeightEnabled = typeof lastValidBlockHeight === "number";

  // Precompute the quest PDA once if the fallback is enabled.
  let pda: PublicKey | undefined;
  if (opts?.creator && typeof opts?.questId === "bigint") {
    [pda] = questPda(opts.creator, opts.questId);
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));

    let visibleAndConfirmed = false;

    let statuses;
    try {
      statuses = await connection.getSignatureStatuses([sig]);
    } catch {
      statuses = undefined; // RPC hiccup — fall through to the other checks
    }

    const status = statuses?.value?.[0];

    if (status?.err) {
      throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`);
    }

    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return; // Done
    }
    if (status) {
      // "processed" — in a block, so the signature is at least visible.
      visibleAndConfirmed = true;
    }
    // status is null/undefined — not yet visible on this RPC node.

    // PDA fallback: a non-null quest account means the fund landed.
    if (pda) {
      try {
        const acct = await connection.getAccountInfo(pda);
        if (acct) return; // Done
      } catch {
        // ignore — never let the PDA check break the loop
      }
    }

    // Blockheight expiry check: if the current height has passed
    // lastValidBlockHeight and the tx is still not visible/confirmed (and the
    // PDA fallback, if enabled, found nothing above), the blockhash is dead and
    // the network will never accept this transaction — fail fast.
    if (blockHeightEnabled && !visibleAndConfirmed) {
      try {
        const currentHeight = await getCurrentBlockHeight();
        if (currentHeight > (lastValidBlockHeight as number)) {
          throw new BlockhashExpiredError();
        }
      } catch (e: any) {
        // Re-throw our own expiry signal; swallow RPC errors from the height read.
        if (e instanceof BlockhashExpiredError) {
          throw e;
        }
      }
    }
  }

  throw new Error(
    `Transaction ${sig} not confirmed within 90 s. ` +
    "It may still land — check Solana Explorer (devnet)."
  );
}

export function useMWA() {
  const { clear } = useWalletStore();

  const connect = useCallback(async () => {
    await transact(async (wallet: Web3MobileWallet) => {
      await authorizeOrReauthorize(wallet);
    });
  }, []);

  const disconnect = useCallback(async () => {
    const { authToken } = useWalletStore.getState();
    if (!authToken) return;
    await transact(async (wallet: Web3MobileWallet) => {
      await wallet.deauthorize({ auth_token: authToken });
    });
    clear();
  }, [clear]);

  return { connect, disconnect };
}
