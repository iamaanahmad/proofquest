import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ProofQuest } from "../target/types/proof_quest";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

const { SystemProgram, SYSVAR_RENT_PUBKEY } = anchor.web3;

describe("proof_quest", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.ProofQuest as Program<ProofQuest>;

  let mint: anchor.web3.PublicKey;
  let creatorTokenAccount: anchor.web3.PublicKey;
  let workerTokenAccount: anchor.web3.PublicKey;

  const creator = anchor.web3.Keypair.generate();
  const worker = anchor.web3.Keypair.generate();
  const REWARD = new anchor.BN(1_000_000); // 1 test-USDC (6 decimals)

  const now = () => Math.floor(Date.now() / 1000);
  const questId = (n: number) => new anchor.BN(n);

  function questPda(creator: anchor.web3.PublicKey, id: anchor.BN) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("quest"), creator.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
  }

  function vaultPda(creator: anchor.web3.PublicKey, id: anchor.BN) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), creator.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
  }

  before(async () => {
    // Airdrop to creator and worker
    for (const kp of [creator, worker]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 2e9);
      await provider.connection.confirmTransaction(sig);
    }

    mint = await createMint(provider.connection, creator, creator.publicKey, null, 6);
    creatorTokenAccount = await createAccount(provider.connection, creator, mint, creator.publicKey);
    workerTokenAccount = await createAccount(provider.connection, worker, mint, worker.publicKey);
    await mintTo(provider.connection, creator, mint, creatorTokenAccount, creator, 100_000_000);
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it("creates and funds a quest", async () => {
    const id = questId(1);
    const [quest] = questPda(creator.publicKey, id);
    const [vault] = vaultPda(creator.publicKey, id);

    await program.methods
      .createAndFundQuest(
        id,
        REWARD,
        new anchor.BN(now() + 3600),
        new anchor.BN(now() + 7200),
        Array.from(Buffer.from("u4pruv")),
        Array.from(Buffer.alloc(32, 1))
      )
      .accounts({
        quest,
        vault,
        creatorTokenAccount,
        mint,
        creator: creator.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([creator])
      .rpc();

    const q = await program.account.quest.fetch(quest);
    assert.equal(q.status.open !== undefined, true);
    assert.equal(q.rewardAmount.toNumber(), REWARD.toNumber());

    const vaultBal = await getAccount(provider.connection, vault);
    assert.equal(Number(vaultBal.amount), REWARD.toNumber());
  });

  it("worker claims the quest", async () => {
    const id = questId(1);
    const [quest] = questPda(creator.publicKey, id);

    await program.methods
      .claimQuest()
      .accounts({ quest, worker: worker.publicKey })
      .signers([worker])
      .rpc();

    const q = await program.account.quest.fetch(quest);
    assert.equal(q.status.claimed !== undefined, true);
    assert.deepEqual(q.worker, worker.publicKey);
  });

  it("worker submits evidence hash", async () => {
    const id = questId(1);
    const [quest] = questPda(creator.publicKey, id);
    const hash = Array.from(Buffer.alloc(32, 0xab));

    await program.methods
      .submitEvidenceHash(hash)
      .accounts({ quest, worker: worker.publicKey })
      .signers([worker])
      .rpc();

    const q = await program.account.quest.fetch(quest);
    assert.equal(q.status.submitted !== undefined, true);
    assert.deepEqual(q.evidenceManifestHash, hash);
  });

  it("creator approves and releases reward", async () => {
    const id = questId(1);
    const [quest] = questPda(creator.publicKey, id);
    const [vault] = vaultPda(creator.publicKey, id);

    const before = await getAccount(provider.connection, workerTokenAccount);

    await program.methods
      .approveAndRelease()
      .accounts({
        quest,
        vault,
        workerTokenAccount,
        creator: creator.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([creator])
      .rpc();

    const after = await getAccount(provider.connection, workerTokenAccount);
    assert.equal(
      Number(after.amount) - Number(before.amount),
      REWARD.toNumber()
    );

    const q = await program.account.quest.fetch(quest);
    assert.equal(q.status.approved !== undefined, true);
  });

  // ── Cancel unclaimed ────────────────────────────────────────────────────────

  it("creator can cancel an unclaimed quest", async () => {
    const id = questId(2);
    const [quest] = questPda(creator.publicKey, id);
    const [vault] = vaultPda(creator.publicKey, id);

    await program.methods
      .createAndFundQuest(
        id, REWARD,
        new anchor.BN(now() + 3600),
        new anchor.BN(now() + 7200),
        Array.from(Buffer.from("u4pruv")),
        Array.from(Buffer.alloc(32, 2))
      )
      .accounts({ quest, vault, creatorTokenAccount, mint, creator: creator.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
      .signers([creator]).rpc();

    const before = await getAccount(provider.connection, creatorTokenAccount);

    await program.methods.cancelUnclaimed()
      .accounts({ quest, vault, creatorTokenAccount, creator: creator.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
      .signers([creator]).rpc();

    const after = await getAccount(provider.connection, creatorTokenAccount);
    assert.equal(Number(after.amount) - Number(before.amount), REWARD.toNumber());

    const q = await program.account.quest.fetch(quest);
    assert.equal(q.status.cancelled !== undefined, true);
  });

  // ── Error paths ─────────────────────────────────────────────────────────────

  it("rejects zero reward", async () => {
    const id = questId(99);
    const [quest] = questPda(creator.publicKey, id);
    const [vault] = vaultPda(creator.publicKey, id);

    try {
      await program.methods
        .createAndFundQuest(id, new anchor.BN(0),
          new anchor.BN(now() + 3600), new anchor.BN(now() + 7200),
          Array.from(Buffer.from("u4pruv")), Array.from(Buffer.alloc(32)))
        .accounts({ quest, vault, creatorTokenAccount, mint, creator: creator.publicKey,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
        .signers([creator]).rpc();
      assert.fail("should have thrown");
    } catch (e: any) {
      assert.include(e.message, "ZeroReward");
    }
  });

  it("rejects creator claiming own quest", async () => {
    const id = questId(3);
    const [quest] = questPda(creator.publicKey, id);
    const [vault] = vaultPda(creator.publicKey, id);

    await program.methods
      .createAndFundQuest(id, REWARD,
        new anchor.BN(now() + 3600), new anchor.BN(now() + 7200),
        Array.from(Buffer.from("u4pruv")), Array.from(Buffer.alloc(32, 3)))
      .accounts({ quest, vault, creatorTokenAccount, mint, creator: creator.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
      .signers([creator]).rpc();

    try {
      await program.methods.claimQuest()
        .accounts({ quest, worker: creator.publicKey })
        .signers([creator]).rpc();
      assert.fail("should have thrown");
    } catch (e: any) {
      assert.include(e.message, "CreatorCannotClaim");
    }
  });

  it("rejects duplicate evidence submission", async () => {
    const id = questId(4);
    const [quest] = questPda(creator.publicKey, id);
    const [vault] = vaultPda(creator.publicKey, id);

    await program.methods
      .createAndFundQuest(id, REWARD,
        new anchor.BN(now() + 3600), new anchor.BN(now() + 7200),
        Array.from(Buffer.from("u4pruv")), Array.from(Buffer.alloc(32, 4)))
      .accounts({ quest, vault, creatorTokenAccount, mint, creator: creator.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
      .signers([creator]).rpc();

    await program.methods.claimQuest()
      .accounts({ quest, worker: worker.publicKey }).signers([worker]).rpc();

    const hash = Array.from(Buffer.alloc(32, 0xcd));
    await program.methods.submitEvidenceHash(hash)
      .accounts({ quest, worker: worker.publicKey }).signers([worker]).rpc();

    try {
      await program.methods.submitEvidenceHash(hash)
        .accounts({ quest, worker: worker.publicKey }).signers([worker]).rpc();
      assert.fail("should have thrown");
    } catch (e: any) {
      // Quest is now Submitted, so second attempt hits NotClaimed (status guard fires first)
      assert.match(e.message, /NotClaimed|AlreadySubmitted/);
    }
  });
});
