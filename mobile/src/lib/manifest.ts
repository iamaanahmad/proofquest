import QuickCrypto from "react-native-quick-crypto";
import type { EvidenceManifest } from "../types";

/** Canonical JSON: sorted keys, UTF-8 encoded. */
export function buildManifest(partial: EvidenceManifest): string {
  return JSON.stringify(partial, Object.keys(partial).sort());
}

/** SHA-256 of a UTF-8 string → Uint8Array (32 bytes). */
export function sha256(data: string): Uint8Array {
  const hash = QuickCrypto.createHash("sha256");
  hash.update(data);
  return new Uint8Array(hash.digest() as ArrayBuffer);
}

/** SHA-256 of raw bytes → Uint8Array. */
export function sha256Bytes(data: Uint8Array): Uint8Array {
  const hash = QuickCrypto.createHash("sha256");
  hash.update(data);
  return new Uint8Array(hash.digest() as ArrayBuffer);
}

/** Hex string from bytes. */
export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}
