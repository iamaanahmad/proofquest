import { useCallback } from "react";
import {
  transact,
  Web3MobileWallet,
} from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { PublicKey } from "@solana/web3.js";
import { Buffer } from "@craftzdog/react-native-buffer";
import { useWalletStore } from "../store/wallet";

const APP_IDENTITY = {
  name: "ProofQuest",
  uri: "https://proofquest.app",
  icon: "favicon.ico",
};

export function useMWA() {
  const { setWallet, clear } = useWalletStore();

  const connect = useCallback(async () => {
    await transact(async (wallet: Web3MobileWallet) => {
      const { accounts, auth_token } = await wallet.authorize({
        cluster: "devnet",
        identity: APP_IDENTITY,
      });
      const pk = new PublicKey(Buffer.from(accounts[0].address, "base64"));
      setWallet(pk, auth_token);
    });
  }, [setWallet]);

  const disconnect = useCallback(async () => {
    const { authToken } = useWalletStore.getState();
    if (!authToken) return;
    await transact(async (wallet: Web3MobileWallet) => {
      await wallet.deauthorize({ auth_token: authToken });
    });
    clear();
  }, [clear]);

  /** Sign and send a transaction, handling stale blockhash retry once. */
  const signAndSend = useCallback(
    async (transaction: any): Promise<string> => {
      const { authToken } = useWalletStore.getState();
      return transact(async (wallet: Web3MobileWallet) => {
        const { signed_transactions } = await wallet.signAndSendTransactions({
          transactions: [transaction],
        });
        return signed_transactions[0] as unknown as string;
      });
    },
    []
  );

  return { connect, disconnect, signAndSend };
}
