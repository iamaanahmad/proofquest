#!/usr/bin/env node
/**
 * scripts/setup-devnet.js
 * Run once: creates test USDC mint on devnet and mints tokens to creator + worker wallets.
 * Usage: node setup-devnet.js <creator-keypair.json> <worker-keypair.json>
 */
const {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} = require("@solana/web3.js");
const {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} = require("@solana/spl-token");
const fs = require("fs");

const RPC = "https://api.devnet.solana.com";
const DECIMALS = 6;
const MINT_AMOUNT = 100 * 10 ** DECIMALS; // 100 test-USDC each

async function main() {
  const [, , creatorPath, workerPath] = process.argv;
  if (!creatorPath || !workerPath) {
    console.error("Usage: node setup-devnet.js <creator.json> <worker.json>");
    process.exit(1);
  }

  const conn = new Connection(RPC, "confirmed");
  const creator = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(creatorPath)))
  );
  const worker = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(workerPath)))
  );

  // Airdrop SOL for rent only if balance is low
  for (const kp of [creator, worker]) {
    const bal = await conn.getBalance(kp.publicKey);
    if (bal < 0.5 * LAMPORTS_PER_SOL) {
      console.log(`Airdropping 2 SOL to ${kp.publicKey.toBase58()}…`);
      const sig = await conn.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig);
    } else {
      console.log(`Skipping airdrop for ${kp.publicKey.toBase58()} (balance: ${(bal / LAMPORTS_PER_SOL).toFixed(2)} SOL)`);
    }
  }

  // Create test USDC mint (creator is mint authority)
  console.log("Creating test USDC mint…");
  const mint = await createMint(conn, creator, creator.publicKey, null, DECIMALS);
  console.log(`TEST_USDC_MINT=${mint.toBase58()}`);

  // Mint tokens to both wallets
  for (const kp of [creator, worker]) {
    const ata = await getOrCreateAssociatedTokenAccount(
      conn, creator, mint, kp.publicKey
    );
    await mintTo(conn, creator, mint, ata.address, creator, MINT_AMOUNT);
    console.log(`Minted 100 test-USDC to ${kp.publicKey.toBase58()}`);
  }

  console.log("\nAdd to mobile/.env:");
  console.log(`TEST_USDC_MINT=${mint.toBase58()}`);
}

main().catch(console.error);
