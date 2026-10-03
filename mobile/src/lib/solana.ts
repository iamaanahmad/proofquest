import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import {
  HELIUS_RPC_URL,
  PROGRAM_ID as ENV_PROGRAM_ID,
  TEST_USDC_MINT as ENV_TEST_USDC_MINT,
} from "@env";
import IDL from "../../program-idl.json";

export const DEVNET_RPC = "https://api.devnet.solana.com";

// Use the Helius RPC when configured in .env; fall back to the public devnet
// endpoint only when it is unset. The public endpoint is rate-limited and
// unreliable for signature-status polling.
const RPC_URL =
  typeof HELIUS_RPC_URL === "string" && HELIUS_RPC_URL.length > 0
    ? HELIUS_RPC_URL
    : DEVNET_RPC;

export const connection = new Connection(RPC_URL, {
  commitment: "confirmed",
  confirmTransactionInitialTimeout: 60000,
  disableRetryOnRateLimit: false,
});

export async function getLatestBlockhashWithFallback(): Promise<{
  blockhash: string;
  lastValidBlockHeight: number;
}> {
  return connection.getLatestBlockhash("confirmed");
}

export async function getCurrentBlockHeight(): Promise<number> {
  return connection.getBlockHeight("confirmed");
}

export const PROGRAM_ID = new PublicKey(ENV_PROGRAM_ID ?? "DmSc562EUuh9yvu2AmEupLLC8wQrXZGVSCZL61EpugvZ");
export const TEST_USDC_MINT = new PublicKey(ENV_TEST_USDC_MINT ?? "DnDYB6ogihxG4uegoQ4dGWfXcf7TjrkqxPKPrbg1qw87");

export const QUEST_SEED = Buffer.from("quest");
export const VAULT_SEED = Buffer.from("vault");

export function questPda(creator: PublicKey, questId: bigint) {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(questId);
  return PublicKey.findProgramAddressSync(
    [QUEST_SEED, creator.toBuffer(), idBuf],
    PROGRAM_ID
  );
}

export function vaultPda(creator: PublicKey, questId: bigint) {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(questId);
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, creator.toBuffer(), idBuf],
    PROGRAM_ID
  );
}

export function getProgram(provider: AnchorProvider) {
  return new Program(IDL as Idl, provider);
}
