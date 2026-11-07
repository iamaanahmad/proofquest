import { Client, Databases, Storage, ID, Query } from "appwrite";

const APPWRITE_ENDPOINT = process.env.APPWRITE_ENDPOINT ?? "https://cloud.appwrite.io/v1";
const APPWRITE_PROJECT  = process.env.APPWRITE_PROJECT_ID!;

export const DATABASE_ID  = process.env.APPWRITE_DATABASE_ID!;
export const QUESTS_COL   = "quests";
export const MANIFESTS_COL = "evidence_manifests";
export const EVIDENCE_BUCKET = "evidence";

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT);

export const db      = new Databases(client);
export const storage = new Storage(client);
export { ID, Query };

// ─── Quest helpers ────────────────────────────────────────────────────────────

export async function getQuest(publicKey: string) {
  // quests use publicKey as document $id
  return db.getDocument(DATABASE_ID, QUESTS_COL, publicKey);
}

export async function insertQuest(data: Record<string, any>) {
  return db.createDocument(DATABASE_ID, QUESTS_COL, data.public_key, data);
}

export async function updateQuest(publicKey: string, data: Record<string, any>) {
  return db.updateDocument(DATABASE_ID, QUESTS_COL, publicKey, data);
}

export async function listNearbyQuests(geohashPrefix: string) {
  return db.listDocuments(DATABASE_ID, QUESTS_COL, [
    Query.equal("status", "open"),
    Query.startsWith("coarse_geohash", geohashPrefix),
    Query.orderAsc("claim_deadline"),
    Query.limit(50),
  ]);
}

export async function listMyQuests(creator: string) {
  return db.listDocuments(DATABASE_ID, QUESTS_COL, [
    Query.equal("creator", creator),
    Query.orderDesc("created_at"),
    Query.limit(50),
  ]);
}

// ─── Manifest helpers ─────────────────────────────────────────────────────────

export async function insertManifest(data: {
  quest_public_key: string;
  worker: string;
  manifest: string;
  manifest_hash: string;
}) {
  return db.createDocument(DATABASE_ID, MANIFESTS_COL, ID.unique(), data);
}

export async function getManifest(questPublicKey: string) {
  const res = await db.listDocuments(DATABASE_ID, MANIFESTS_COL, [
    Query.equal("quest_public_key", questPublicKey),
    Query.limit(1),
  ]);
  return res.documents[0] ?? null;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

export async function uploadEvidence(objectId: string, blob: Uint8Array) {
  const file = new File([blob], objectId.split("/").pop()!, { type: "image/jpeg" });
  return storage.createFile(EVIDENCE_BUCKET, ID.unique(), file);
}

export function getEvidencePreviewUrl(fileId: string): string {
  return `${APPWRITE_ENDPOINT}/storage/buckets/${EVIDENCE_BUCKET}/files/${fileId}/view?project=${APPWRITE_PROJECT}`;
}
