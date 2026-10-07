import {
  PublicKey,
  Transaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { connection, getProgram, questPda, vaultPda, TEST_USDC_MINT } from "./solana";

function provider(publicKey: PublicKey, signTransaction: any): AnchorProvider {
  return new AnchorProvider(
    connection,
    { publicKey, signTransaction, signAllTransactions: signTransaction },
    { commitment: "confirmed" }
  );
}

export async function buildCreateAndFundTx(
  creatorPk: PublicKey,
  questId: bigint,
  rewardAmount: number,
  claimDeadline: number,
  submitDeadline: number,
  geohash: string,
  schemaHash: number[]
): Promise<Transaction> {
  const [questPdaKey] = questPda(creatorPk, questId);
  const [vaultKey] = vaultPda(creatorPk, questId);
  const creatorAta = await getAssociatedTokenAddress(TEST_USDC_MINT, creatorPk);

  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(questId);

  const ghBytes = Buffer.alloc(6);
  Buffer.from(geohash.slice(0, 6)).copy(ghBytes);

  const prog = getProgram(
    new AnchorProvider(connection, {} as any, { commitment: "confirmed" })
  );

  const tx = await prog.methods
    .createAndFundQuest(
      new BN(questId.toString()),
      new BN(rewardAmount),
      new BN(claimDeadline),
      new BN(submitDeadline),
      Array.from(ghBytes),
      schemaHash
    )
    .accounts({
      quest: questPdaKey,
      vault: vaultKey,
      creatorTokenAccount: creatorAta,
      mint: TEST_USDC_MINT,
      creator: creatorPk,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .transaction();

  let ataInfo = null;
  try {
    ataInfo = await connection.getAccountInfo(creatorAta);
  } catch (e) {
    console.warn("getAccountInfo creatorAta warning:", e);
  }
  if (!ataInfo) {
    tx.instructions.unshift(
      createAssociatedTokenAccountInstruction(creatorPk, creatorAta, creatorPk, TEST_USDC_MINT)
    );
  }

  return tx;
}

export async function buildClaimTx(
  creatorPk: PublicKey,
  questId: bigint,
  workerPk: PublicKey
): Promise<Transaction> {
  const [questPdaKey] = questPda(creatorPk, questId);
  const prog = getProgram(
    new AnchorProvider(connection, {} as any, { commitment: "confirmed" })
  );

  return prog.methods
    .claimQuest()
    .accounts({ quest: questPdaKey, worker: workerPk })
    .transaction();
}

export async function buildSubmitTx(
  creatorPk: PublicKey,
  questId: bigint,
  workerPk: PublicKey,
  manifestHash: number[]
): Promise<Transaction> {
  const [questPdaKey] = questPda(creatorPk, questId);
  const prog = getProgram(
    new AnchorProvider(connection, {} as any, { commitment: "confirmed" })
  );

  return prog.methods
    .submitEvidenceHash(manifestHash)
    .accounts({ quest: questPdaKey, worker: workerPk })
    .transaction();
}

export async function buildApproveTx(
  creatorPk: PublicKey,
  questId: bigint,
  workerPk: PublicKey
): Promise<Transaction> {
  const [questPdaKey] = questPda(creatorPk, questId);
  const [vaultKey] = vaultPda(creatorPk, questId);
  const workerAta = await getAssociatedTokenAddress(TEST_USDC_MINT, workerPk);
  const prog = getProgram(
    new AnchorProvider(connection, {} as any, { commitment: "confirmed" })
  );

  // Create worker ATA if it doesn't exist yet
  let ataInfo = null;
  try {
    ataInfo = await connection.getAccountInfo(workerAta);
  } catch (e) {
    console.warn("getAccountInfo workerAta warning:", e);
  }
  const tx = await prog.methods
    .approveAndRelease()
    .accounts({
      quest: questPdaKey,
      vault: vaultKey,
      workerTokenAccount: workerAta,
      creator: creatorPk,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .transaction();

  if (!ataInfo) {
    tx.instructions.unshift(
      createAssociatedTokenAccountInstruction(creatorPk, workerAta, workerPk, TEST_USDC_MINT)
    );
  }

  return tx;
}

export async function buildCancelTx(
  creatorPk: PublicKey,
  questId: bigint
): Promise<Transaction> {
  const [questPdaKey] = questPda(creatorPk, questId);
  const [vaultKey] = vaultPda(creatorPk, questId);
  const creatorAta = await getAssociatedTokenAddress(TEST_USDC_MINT, creatorPk);
  const prog = getProgram(
    new AnchorProvider(connection, {} as any, { commitment: "confirmed" })
  );

  return prog.methods
    .cancelUnclaimed()
    .accounts({
      quest: questPdaKey,
      vault: vaultKey,
      creatorTokenAccount: creatorAta,
      creator: creatorPk,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .transaction();
}

export async function buildRefundTx(
  creatorPk: PublicKey,
  questId: bigint
): Promise<Transaction> {
  const [questPdaKey] = questPda(creatorPk, questId);
  const [vaultKey] = vaultPda(creatorPk, questId);
  const creatorAta = await getAssociatedTokenAddress(TEST_USDC_MINT, creatorPk);
  const prog = getProgram(
    new AnchorProvider(connection, {} as any, { commitment: "confirmed" })
  );

  // refund_expired takes no signer in the program — anyone can trigger it once
  // submit_deadline has passed without an approval. Funds return to the
  // creator's token account.
  return prog.methods
    .refundExpired()
    .accounts({
      quest: questPdaKey,
      vault: vaultKey,
      creatorTokenAccount: creatorAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .transaction();
}
