import { create } from "zustand";
import { PublicKey } from "@solana/web3.js";

export type Role = "requester" | "worker" | null;

interface WalletState {
  publicKey: PublicKey | null;
  role: Role;
  authToken: string | null;
  setWallet: (pk: PublicKey, token: string) => void;
  setRole: (role: Role) => void;
  clear: () => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  publicKey: null,
  role: null,
  authToken: null,
  setWallet: (publicKey, authToken) => set({ publicKey, authToken }),
  setRole: (role) => set({ role }),
  clear: () => set({ publicKey: null, role: null, authToken: null }),
}));
