import { Client, Databases, Storage, Account, ID, Query } from "appwrite";
import AsyncStorage from "@react-native-async-storage/async-storage";
import QuickCrypto from "react-native-quick-crypto";
import { Buffer } from "@craftzdog/react-native-buffer";

const APPWRITE_ENDPOINT  = "https://citorg.in/v1";
const APPWRITE_PROJECT   = "proofquest";

export const DATABASE_ID     = "proofquest";
export const QUESTS_COL      = "quests";
export const MANIFESTS_COL   = "evidence_manifests";
export const EVIDENCE_BUCKET = "evidence";

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT);

export const db      = new Databases(client);
export const storage = new Storage(client);
const account        = new Account(client);

const SESSION_KEY = "appwrite_session";

const SESSION_SECRET_KEY = "appwrite_session_secret";

/**
 * Ensures a usable anonymous Appwrite session.
 *
 * The Appwrite WEB SDK authenticates via a cookie, which React Native does NOT
 * persist across app restarts (there's no browser cookie jar). So after a
 * restart / app-data-clear / wallet-switch, the stored "session id" flag could
 * exist while the SDK had no credential attached — every request then went out
 * as the `guests` role and failed with "current user is not authorized".
 *
 * Fix: persist the session SECRET and re-apply it to the client via
 * setSession() so the SDK sends it as a header on every request, independent of
 * cookies. We verify the re-applied session with getAccount() and recreate it
 * if it's gone.
 */
export async function ensureAppwriteSession(): Promise<void> {
  // 1. Try to restore a persisted session secret onto the client.
  const savedSecret = await AsyncStorage.getItem(SESSION_SECRET_KEY);
  if (savedSecret) {
    try {
      client.setSession(savedSecret);
      await account.get(); // verify it's live for this user
      return; // restored and valid
    } catch {
      // Stale/expired — clear and fall through to create a fresh one.
      await AsyncStorage.removeItem(SESSION_SECRET_KEY);
      await AsyncStorage.removeItem(SESSION_KEY);
      client.setSession("");
    }
  }

  // 2. Create a new anonymous session and persist its secret.
  try {
    const session = await account.createAnonymousSession();
    if (session.secret) {
      client.setSession(session.secret);
      await AsyncStorage.setItem(SESSION_SECRET_KEY, session.secret);
    }
    await AsyncStorage.setItem(SESSION_KEY, session.$id);
  } catch (e: any) {
    // A session may already exist on the client (same-run race). If we can read
    // the account, we're authenticated — otherwise rethrow.
    try {
      await account.get();
    } catch {
      throw e;
    }
  }
}
export { ID, Query };

/**
 * Clears the local Appwrite session so the next role/wallet starts fresh.
 * Called on disconnect. Best-effort: also tries to delete the server session.
 */
export async function clearAppwriteSession(): Promise<void> {
  try {
    await account.deleteSession("current");
  } catch {
    // ignore — session may already be gone
  }
  client.setSession("");
  await AsyncStorage.removeItem(SESSION_SECRET_KEY);
  await AsyncStorage.removeItem(SESSION_KEY);
}

/**
 * Appwrite document IDs are limited to 36 chars (a-z, A-Z, 0-9, hyphen,
 * underscore, not starting with a special char). A Solana quest PDA is a
 * base58 pubkey ~44 chars long, so it can't be used directly as a doc ID.
 *
 * We derive a deterministic 32-char hex ID from the PDA via SHA-256. The full
 * PDA is still stored in the `public_key` field for querying/display. Because
 * the derivation is deterministic, getQuest/updateQuest produce the SAME id
 * from the same PDA, so lookups by PDA keep working across screens.
 */
export function questDocId(questPublicKey: string): string {
  const hash = QuickCrypto.createHash("sha256");
  hash.update(questPublicKey);
  const digest = hash.digest() as unknown as Uint8Array;
  const hex = Buffer.from(digest).toString("hex");
  return hex.slice(0, 32); // 32 hex chars, well within Appwrite's 36-char limit
}

/**
 * Appwrite stores quest fields in snake_case (reward_amount, claim_deadline,
 * public_key, …) but the app's Quest type and all screens use camelCase
 * (rewardAmount, claimDeadline, publicKey, …). Reading a raw document therefore
 * yields undefined for every camelCase access → "NaN USDC" / "Invalid Date".
 *
 * This maps a raw Appwrite quest document into the camelCase Quest shape.
 * created_at / submitted_at are stored as ISO strings; we convert them to unix
 * seconds (numbers) to match the Quest type and the screens' Date math.
 */
function toUnixSeconds(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return v; // already a unix timestamp
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

export function mapQuestDoc(doc: any) {
  return {
    ...doc, // keep $id and any extra Appwrite metadata
    publicKey: doc.public_key,
    questId: doc.quest_id,
    creator: doc.creator,
    worker: doc.worker ?? null,
    mint: doc.mint,
    rewardAmount: typeof doc.reward_amount === "number" ? doc.reward_amount : Number(doc.reward_amount) || 0,
    status: doc.status,
    createdAt: toUnixSeconds(doc.created_at),
    claimDeadline: typeof doc.claim_deadline === "number" ? doc.claim_deadline : toUnixSeconds(doc.claim_deadline),
    submitDeadline: typeof doc.submit_deadline === "number" ? doc.submit_deadline : toUnixSeconds(doc.submit_deadline),
    coarseGeohash: doc.coarse_geohash,
    evidenceSchemaHash: doc.evidence_schema_hash,
    evidenceManifestHash: doc.evidence_manifest_hash ?? null,
    submittedAt: doc.submitted_at ? toUnixSeconds(doc.submitted_at) : null,
    title: doc.title,
    description: doc.description,
    templateId: doc.template_id,
    areaLabel: doc.area_label,
  };
}

export async function getQuest(publicKey: string) {
  const doc = await db.getDocument(DATABASE_ID, QUESTS_COL, questDocId(publicKey));
  return mapQuestDoc(doc);
}

export async function insertQuest(data: Record<string, any>) {
  await ensureAppwriteSession();
  const docId = questDocId(data.public_key);
  try {
    return await db.createDocument(DATABASE_ID, QUESTS_COL, docId, data);
  } catch (e: any) {
    // Idempotent: if this quest was already saved (e.g. the AppState resume
    // path re-runs completePendingQuest for a quest that already landed), a
    // duplicate-ID 409 is not a real failure — the quest exists. Return the
    // existing document instead of surfacing an error to the user.
    const code = e?.code ?? e?.response?.code;
    const msg = String(e?.message ?? "");
    if (code === 409 || /already exist/i.test(msg)) {
      return db.getDocument(DATABASE_ID, QUESTS_COL, docId);
    }
    throw e;
  }
}

export async function updateQuest(publicKey: string, data: Record<string, any>) {
  return db.updateDocument(DATABASE_ID, QUESTS_COL, questDocId(publicKey), data);
}

export async function listNearbyQuests(geohashPrefix: string) {
  const res = await db.listDocuments(DATABASE_ID, QUESTS_COL, [
    Query.equal("status", "open"),
    Query.startsWith("coarse_geohash", geohashPrefix),
    Query.orderAsc("claim_deadline"),
    Query.limit(50),
  ]);
  return { ...res, documents: res.documents.map(mapQuestDoc) };
}

/**
 * Quests the given worker is actively working on (claimed or submitted),
 * so the worker Home can show in-progress quests to resume — not just the
 * nearby open ones. Without this, a quest the worker already claimed vanishes
 * from every list (it's no longer "open"), leaving no way to continue it.
 */
export async function listMyWorkQuests(worker: string) {
  const res = await db.listDocuments(DATABASE_ID, QUESTS_COL, [
    Query.equal("worker", worker),
    Query.orderDesc("created_at"),
    Query.limit(50),
  ]);
  return { ...res, documents: res.documents.map(mapQuestDoc) };
}

export async function listMyQuests(creator: string) {
  const res = await db.listDocuments(DATABASE_ID, QUESTS_COL, [
    Query.equal("creator", creator),
    Query.orderDesc("created_at"),
    Query.limit(50),
  ]);
  return { ...res, documents: res.documents.map(mapQuestDoc) };
}

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

export async function uploadEvidence(objectId: string, fileUri: string) {
  // The bucket's create permission is create("users"), so an Appwrite session
  // MUST exist before uploading (anonymous session counts as the users role).
  await ensureAppwriteSession();

  // The Appwrite WEB SDK's createFile uploads a Blob via FormData, which fails
  // on React Native ("Network request failed" / blob-from-arraybuffer errors):
  // RN's networking only reliably uploads a file part described as
  // { uri, name, type }. So we bypass the SDK and POST a native multipart
  // request ourselves.
  const name = objectId.split("/").pop() || "evidence.jpg";
  const fileId = ID.unique();

  const form = new FormData();
  form.append("fileId", fileId);
  // React Native file part shape — NOT a Blob/File. RN serializes this to a
  // proper multipart file from the local URI.
  form.append("file", { uri: fileUri, name, type: "image/jpeg" } as any);

  // Authenticate with the SESSION SECRET header (same credential the SDK now
  // uses via setSession) — RN does not persist the cookie, so we send it
  // explicitly. We send ONLY this header (no JWT) to avoid Appwrite's
  // user_jwt_and_cookie_set conflict.
  const sessionSecret = (await AsyncStorage.getItem(SESSION_SECRET_KEY)) ?? "";
  const res = await fetch(
    `${APPWRITE_ENDPOINT}/storage/buckets/${EVIDENCE_BUCKET}/files`,
    {
      method: "POST",
      headers: {
        "X-Appwrite-Project": APPWRITE_PROJECT,
        "X-Appwrite-Session": sessionSecret,
        // NOTE: do NOT set Content-Type; RN sets the multipart boundary itself.
      },
      body: form,
    }
  );

  if (!res.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      detail = `HTTP ${res.status}`;
    }
    throw new Error(`Evidence upload failed: ${detail}`);
  }

  return res.json();
}

export function getEvidencePreviewUrl(fileId: string): string {
  return `${APPWRITE_ENDPOINT}/storage/buckets/${EVIDENCE_BUCKET}/files/${fileId}/view?project=${APPWRITE_PROJECT}`;
}
