import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import IDL from "../../program-idl.json";

export const DEVNET_RPC = "https://api.devnet.solana.com";
export const connection = new Connection(DEVNET_RPC, "confirmed");

export const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID ?? "DmSc562EUuh9yvu2AmEupLLC8wQrXZGVSCZL61EpugvZ");
export const TEST_USDC_MINT = new PublicKey(process.env.TEST_USDC_MINT ?? "DnDYB6ogihxG4uegoQ4dGWfXcf7TjrkqxPKPrbg1qw87");

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
