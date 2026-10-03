/**
 * Self-contained unit tests for waitForConfirmation's retryable expiry signal
 * and PDA-existence gate. Mocks ../lib/solana so no real RPC / @env is touched,
 * and never imports App / navigation / CreateQuestScreen.
 */

// Mock the heavy native/ESM deps that useMWA imports at module load so jest
// does not have to transform @solana/web3.js's transitive ESM tree. These are
// not exercised by waitForConfirmation (its RPC calls go through the mocked
// ../lib/solana below); PublicKey is only used as a type here.
jest.mock('@solana-mobile/mobile-wallet-adapter-protocol-web3js', () => ({
  transact: jest.fn(),
}));
jest.mock('@solana/web3.js', () => ({
  Transaction: class {},
  PublicKey: class {},
}));
jest.mock('@craftzdog/react-native-buffer', () => ({ Buffer: class {} }));

// Mock the solana lib BEFORE importing the hook so the hook binds to the mocks.
jest.mock('../../lib/solana', () => {
  const getSignatureStatuses = jest.fn();
  const getAccountInfo = jest.fn();
  return {
    connection: { getSignatureStatuses, getAccountInfo },
    getCurrentBlockHeight: jest.fn(),
    getLatestBlockhashWithFallback: jest.fn(),
    questPda: jest.fn(() => [{ toBase58: () => 'FakePda1111111111111111111111111111111111' }]),
  };
});

import { waitForConfirmation, BlockhashExpiredError } from '../useMWA';
import {
  connection,
  getCurrentBlockHeight,
} from '../../lib/solana';

// Typed handles to the mocked functions.
const mockGetSignatureStatuses = connection.getSignatureStatuses as jest.Mock;
const mockGetAccountInfo = connection.getAccountInfo as jest.Mock;
const mockGetCurrentBlockHeight = getCurrentBlockHeight as unknown as jest.Mock;

const SIG = '5'.repeat(44);

/**
 * waitForConfirmation sleeps 2s per attempt via setTimeout. With fake timers we
 * drive those timers to completion so the test runs instantly. The helper awaits
 * microtasks between timer flushes so the mocked promises resolve.
 */
async function runWithFakeTimers(promise: Promise<unknown>) {
  // Advance repeatedly to clear the poll waits regardless of how many
  // iterations the loop runs.
  for (let i = 0; i < 100; i++) {
    await Promise.resolve();
    jest.advanceTimersByTime(2000);
    await Promise.resolve();
  }
  return promise;
}

describe('waitForConfirmation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGetSignatureStatuses.mockReset();
    mockGetAccountInfo.mockReset();
    mockGetCurrentBlockHeight.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('throws BlockhashExpiredError when height > lastValidBlockHeight and PDA absent', async () => {
    mockGetSignatureStatuses.mockResolvedValue({ value: [null] });
    mockGetAccountInfo.mockResolvedValue(null); // PDA does not exist
    mockGetCurrentBlockHeight.mockResolvedValue(1000); // past lastValidBlockHeight

    const p = waitForConfirmation(SIG, {
      lastValidBlockHeight: 500,
      creator: { toBuffer: () => new Uint8Array(32) } as any,
      questId: 1n,
    });

    const assertion = expect(runWithFakeTimers(p)).rejects.toBeInstanceOf(
      BlockhashExpiredError
    );
    await assertion;
  });

  it('resolves (no throw) when the quest PDA account exists even if status is null', async () => {
    mockGetSignatureStatuses.mockResolvedValue({ value: [null] });
    mockGetAccountInfo.mockResolvedValue({ lamports: 1 }); // PDA exists
    mockGetCurrentBlockHeight.mockResolvedValue(1000);

    const p = waitForConfirmation(SIG, {
      lastValidBlockHeight: 500,
      creator: { toBuffer: () => new Uint8Array(32) } as any,
      questId: 1n,
    });

    await expect(runWithFakeTimers(p)).resolves.toBeUndefined();
  });

  it('resolves when the signature status is confirmed', async () => {
    mockGetSignatureStatuses.mockResolvedValue({
      value: [{ confirmationStatus: 'confirmed' }],
    });
    mockGetAccountInfo.mockResolvedValue(null);
    mockGetCurrentBlockHeight.mockResolvedValue(100);

    const p = waitForConfirmation(SIG, { lastValidBlockHeight: 500 });

    await expect(runWithFakeTimers(p)).resolves.toBeUndefined();
  });

  it('rejects with a non-expiry error when the tx failed on-chain', async () => {
    mockGetSignatureStatuses.mockResolvedValue({
      value: [{ err: { InstructionError: [0, 'Custom'] } }],
    });
    mockGetAccountInfo.mockResolvedValue(null);
    mockGetCurrentBlockHeight.mockResolvedValue(100);

    const p = waitForConfirmation(SIG, { lastValidBlockHeight: 500 });

    const assertion = expect(runWithFakeTimers(p)).rejects.toThrow(
      /failed on-chain/
    );
    await assertion;
    // And it is specifically NOT the retryable expiry signal.
    await expect(runWithFakeTimers(waitForConfirmation(SIG, { lastValidBlockHeight: 500 })))
      .rejects.not.toBeInstanceOf(BlockhashExpiredError);
  });
});
