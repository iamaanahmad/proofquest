import { create } from "zustand";
import { PublicKey } from "@solana/web3.js";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type Role = "requester" | "worker" | null;

interface WalletState {
  publicKey: PublicKey | null;
  role: Role;
  authToken: string | null;
  hydrated: boolean;
  setWallet: (pk: PublicKey, token: string) => void;
  setRole: (role: Role) => void;
  clear: () => void;
  hydrate: () => Promise<void>;
}

export const useWalletStore = create<WalletState>((set) => ({
  publicKey: null,
  role: null,
  authToken: null,
  hydrated: false,

  setWallet: (publicKey, authToken) => {
    AsyncStorage.setItem("auth_token", authToken);
    AsyncStorage.setItem("public_key", publicKey.toBase58());
    set({ publicKey, authToken });
  },

  setRole: (role) => {
    if (role) AsyncStorage.setItem("role", role);
    else AsyncStorage.removeItem("role");
    set({ role });
  },

  clear: () => {
    // Use individual removeItem calls: multiRemove is undefined on this
    // AsyncStorage version and throws "undefined is not a function".
    AsyncStorage.removeItem("auth_token");
    AsyncStorage.removeItem("role");
    AsyncStorage.removeItem("public_key");
    set({ publicKey: null, role: null, authToken: null });
  },

  hydrate: async () => {
    const [token, role, pkStr] = await Promise.all([
      AsyncStorage.getItem("auth_token"),
      AsyncStorage.getItem("role"),
      AsyncStorage.getItem("public_key"),
    ]);
    const publicKey = pkStr ? new PublicKey(pkStr) : null;
    set({ authToken: token, role: role as Role, publicKey, hydrated: true });
  },
}));
