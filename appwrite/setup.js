#!/usr/bin/env node
/**
 * appwrite/setup.js
 * Run once to create the Appwrite database, collections and storage bucket.
 * Usage: APPWRITE_ENDPOINT=... APPWRITE_PROJECT_ID=... APPWRITE_API_KEY=... node setup.js
 */
const {
  Client, Databases, Storage,
  Permission, Role, ID, IndexType,
} = require("node-appwrite");

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT ?? "https://cloud.appwrite.io/v1")
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const db      = new Databases(client);
const storage = new Storage(client);

const DB_ID           = "proofquest";
const QUESTS_COL      = "quests";
const MANIFESTS_COL   = "evidence_manifests";
const EVIDENCE_BUCKET = "evidence";

const skip = (label) => (e) => console.log(`  skip (${label}): ${e.message}`);

async function createStringAttr(col, key, size, required) {
  await db.createStringAttribute(DB_ID, col, key, size, required)
    .catch(skip(`attr ${key}`));
}

async function createIntAttr(col, key, required) {
  await db.createIntegerAttribute(DB_ID, col, key, required)
    .catch(skip(`attr ${key}`));
}

async function main() {
  // ── Database ──────────────────────────────────────────────────────────────
  console.log("Creating database…");
  await db.create(DB_ID, "ProofQuest").catch(skip("database"));

  // ── Quests collection ─────────────────────────────────────────────────────
  console.log("Creating quests collection…");
  await db.createCollection(DB_ID, QUESTS_COL, "quests", [
    Permission.read(Role.any()),
    Permission.create(Role.users()),
    Permission.update(Role.users()),
  ]).catch(skip("quests collection"));

  await createStringAttr(QUESTS_COL, "quest_id",               64,   true);
  await createStringAttr(QUESTS_COL, "creator",                64,   true);
  await createStringAttr(QUESTS_COL, "worker",                 64,   false);
  await createStringAttr(QUESTS_COL, "mint",                   64,   true);
  await createIntAttr   (QUESTS_COL, "reward_amount",                true);
  await createStringAttr(QUESTS_COL, "status",                 16,   true);
  await createIntAttr   (QUESTS_COL, "claim_deadline",               true);
  await createIntAttr   (QUESTS_COL, "submit_deadline",              true);
  await createStringAttr(QUESTS_COL, "coarse_geohash",         12,   true);
  await createStringAttr(QUESTS_COL, "area_label",             64,   false);
  await createStringAttr(QUESTS_COL, "evidence_schema_hash",   64,   true);
  await createStringAttr(QUESTS_COL, "evidence_manifest_hash", 64,   false);
  await createStringAttr(QUESTS_COL, "submitted_at",           32,   false);
  await createStringAttr(QUESTS_COL, "template_id",            32,   false);
  await createStringAttr(QUESTS_COL, "title",                  128,  false);
  await createStringAttr(QUESTS_COL, "description",            512,  false);
  await createStringAttr(QUESTS_COL, "created_at",             32,   true);

  console.log("Creating quests indexes…");
  await db.createIndex(DB_ID, QUESTS_COL, "status_geohash", IndexType.Key,
    ["status", "coarse_geohash"]).catch(skip("index status_geohash"));
  await db.createIndex(DB_ID, QUESTS_COL, "creator_idx", IndexType.Key,
    ["creator"]).catch(skip("index creator_idx"));

  // ── Evidence manifests collection ─────────────────────────────────────────
  console.log("Creating evidence_manifests collection…");
  await db.createCollection(DB_ID, MANIFESTS_COL, "evidence_manifests", [
    Permission.create(Role.users()),
    Permission.read(Role.users()),
  ]).catch(skip("manifests collection"));

  await createStringAttr(MANIFESTS_COL, "quest_public_key", 64,   true);
  await createStringAttr(MANIFESTS_COL, "worker",           64,   true);
  await createStringAttr(MANIFESTS_COL, "manifest",         8192, true);
  await createStringAttr(MANIFESTS_COL, "manifest_hash",    64,   true);

  console.log("Creating manifests indexes…");
  await db.createIndex(DB_ID, MANIFESTS_COL, "quest_idx", IndexType.Key,
    ["quest_public_key"]).catch(skip("index quest_idx"));

  // ── Storage bucket ────────────────────────────────────────────────────────
  console.log("Creating evidence storage bucket…");
  await storage.createBucket(EVIDENCE_BUCKET, "evidence", [
    Permission.create(Role.users()),
    Permission.read(Role.users()),
  ], false).catch(skip("bucket"));

  console.log("\n✅ Appwrite setup complete.");
  console.log(`Database ID: ${DB_ID}`);
}

main().catch(console.error);
