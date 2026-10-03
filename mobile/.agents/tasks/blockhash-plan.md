# Implementation Plan — Fix "blockhash expired" on Fund & Publish Quest

## Context & root cause (confirmed)

In `signAndBroadcast` (`src/hooks/useMWA.ts`) the recent blockhash is fetched
**before** `transact()` opens the MWA session. The whole human round-trip
(Phantom opens → approve connection → approve tx → return to app) runs between
that fetch and the actual broadcast, so by broadcast time the blockhash is
older than the devnet validity window (~150 slots, ~60–90 s). The network
silently drops the tx; `waitForConfirmation` correctly diagnoses expiry but the
send never lands. On-chain `getSignaturesForAddress` for
`DmSc562EUuh9yvu2AmEupLLC8wQrXZGVSCZL61EpugvZ` shows only 3 old txns (Sept 22),
confirming a genuine drop, not a confirmation-visibility lag.

## Investigation findings (evidence)

### 1(a) — Does a `getLatestBlockhash` call INSIDE `transact()` risk closing the MWA session?

**Answer: No. The load-bearing comment is overcautious.** The dApp's Solana RPC
`connection` (Helius HTTP) and the MWA session (native TurboModule transport)
are two completely independent channels.

Evidence from the **installed** library source (v2.3.0):

- `node_modules/@solana-mobile/mobile-wallet-adapter-protocol/lib/cjs/index.native.js`
  — `transact(callback, config)` does:
  `startSession(config)` → `await callback(proxy)` → `finally { endSession() }`.
  The session is held open for the **entire lifetime of the callback promise**.
  It is closed only when (a) the callback settles, or (b) the native transport
  itself raises `ERROR_SESSION_CLOSED` / `ERROR_SESSION_TIMEOUT`. There is no
  logic that watches the dApp's HTTP RPC traffic or closes the session on an
  idle gap caused by an `await` to a *different* server.
- Each wallet method (e.g. `signAndSendTransactions`) is dispatched through
  `createMobileWalletProxy` → `SolanaMobileWalletAdapter.invoke(method, params)`
  — a native call over the already-open session. It does **not** touch the
  dApp's `connection`.
- Therefore a short `connection.getLatestBlockhash()` awaited inside the
  callback is just an HTTP round-trip on an unrelated socket; it does not
  signal, pause, or close the MWA session.
- The only in-session risk is **elapsed idle time** triggering
  `ERROR_SESSION_TIMEOUT`. A single sub-second blockhash fetch adds negligible
  idle time, and the unavoidable multi-second approval delay already happens
  **inside** `signAndSendTransactions` (that call is what renders Phantom's UI).

Corroboration from official Solana Mobile docs
([Building transactions](https://docs.solanamobile.com/react-native/building_transactions)):
the recommended `sendTransactions` helper fetches the blockhash, compiles,
signs, and sends **as one in-interaction unit**, and `signAndSendTransactions`
is paired with the `minContextSlot` "the blockhash was fetched at" — i.e. the
documented pattern fetches the blockhash in close proximity to the send, not
long before the session opens. Content was rephrased for compliance with
licensing restrictions.

**Conclusion:** Move the `getLatestBlockhash` fetch to **inside** the
`transact()` callback, immediately **after** `authorizeOrReauthorize` and
immediately **before** `signAndSendTransactions`, with no other `await` between
the fetch and the send. This cuts staleness down to just the approval duration
(the irreducible minimum) and needs no second Phantom prompt in the common case.

### 1(b) — Does `signAndSendTransactions` let the WALLET supply/replace the blockhash?

**Answer: No. The dApp-supplied `tx.recentBlockhash` is authoritative.**

Evidence from
`node_modules/@solana-mobile/mobile-wallet-adapter-protocol-web3js/lib/cjs/index.native.js`:
`getPayloadFromTransaction` calls `transaction.serialize({ requireAllSignatures:
false, verifySignatures: false })` and base64-encodes the result as the payload
sent to the wallet. The wallet signs and submits **exactly the message the dApp
compiled**, including its `recentBlockhash`. The type
(`lib/types/index.d.ts`, `Web3SignAndSendTransactionsAPI`) exposes only
`minContextSlot / commitment / skipPreflight / maxRetries /
waitForCommitmentToSendNextTransaction / transactions` — there is **no**
blockhash field for the wallet to inject. So the fix must make the dApp's
blockhash fresh; the wallet will not rescue a stale one.

**Corollary (critical for the retry design):** a transaction signed by the
wallet is bound to the blockhash present at sign time. Re-broadcasting the
**same signed tx** cannot escape expiry. A genuine retry must obtain a **new
signature over a new blockhash** — i.e. re-enter the MWA sign+send flow.

## Fix strategy (decided)

**Primary fix:** move the blockhash fetch inside `transact()` (per 1a). This
alone should resolve the common case because staleness drops to the approval
duration.

**Secondary safety net:** a bounded retry-with-fresh-blockhash loop
(2 attempts total). If `waitForConfirmation` detects expiry (height past
`lastValidBlockHeight`, tx never visible, **and** quest PDA absent),
`signAndBroadcast` re-enters `transact()` once with a brand-new blockhash and a
new signature. A second Phantom prompt is acceptable and is clearly messaged.

**PDA-existence gate (prevents double-funding):** before any retry — and at the
top of attempt 2 — check `getAccountInfo(questPda)`. If the PDA exists, the
first attempt actually landed; return that success instead of prompting again.
This makes the retry idempotent and cannot double-fund.

**Retryable signal shape:** a dedicated typed error class
`BlockhashExpiredError extends Error` (exported from `useMWA.ts`). `name =
"BlockhashExpiredError"`, carries no extra fields. `waitForConfirmation` throws
this **specific** class on the expiry branch (instead of the generic
`new Error("Transaction expired …")`). The retry loop catches it by
`instanceof` / `name` check; every other error (on-chain failure, genuine
non-expiry timeout) propagates unchanged. The genuine-timeout message
("It may still land — check Solana Explorer (devnet)") stays only on the
true non-expiry timeout path.

## Verification reality (read before trusting any "run tsc / npm test" step)

Checked at baseline on the untouched repo:
- `npx tsc --noEmit` already reports **many pre-existing errors** (missing
  `@types/node` so `Buffer` is undefined in `solana.ts`/`transactions.ts`,
  missing module decls, StatusBar prop typing, plus two existing errors in
  `useMWA.ts` at lines 93 and 151). tsc is therefore **not** a clean gate; the
  only usable tsc signal is "my changes introduce **no new** error in the files
  I touch beyond those already present."
- `npm test` already **fails** at baseline: the default `@react-native/jest-preset`
  does not transform `@react-navigation/native`'s ESM (`SyntaxError: Unexpected
  token 'export'` from `App.tsx`'s import chain). So the suite is red before any
  change too.

Consequence for the plan: the new logic must be covered by a **self-contained**
unit test that does **not** import `App.tsx` or the navigation stack, and the
jest `transformIgnorePatterns` must be widened so the test can run. See items 1
and 5.

---

# Implementation Plan

- [ ] 1. Fix the jest config so a focused unit test can run, without touching the app's runtime.
      Replace the bare preset in `jest.config.js` with the preset plus a
      `transformIgnorePatterns` that whitelists the ESM packages pulled in
      transitively (`@react-navigation`, `@solana-mobile`, `@solana`,
      `react-native`, `@craftzdog`), and add a `moduleNameMapper` stub for
      `@env` so modules that `import ... from "@env"` load under jest. Add a
      `test:unit` script to `package.json`:
      `"test:unit": "jest src/hooks"`. Do NOT change `babel.config.js` runtime
      aliases.
      Files: `mobile/jest.config.js`, `mobile/package.json`
      Verify: `npx jest --listTests` runs without a config error and lists the
      hooks test dir. (Full `npm test` may still fail on the pre-existing
      `App.test.tsx` ESM issue — that is out of scope; confirm only that the
      config loads.)

- [ ] 2. Add the typed retryable signal and make `waitForConfirmation` throw it on expiry.
      In `src/hooks/useMWA.ts` add and export
      `export class BlockhashExpiredError extends Error { constructor(msg?: string){ super(msg ?? "Transaction expired (blockhash no longer valid) — please try again."); this.name = "BlockhashExpiredError"; } }`.
      In `waitForConfirmation`, on the blockheight-expiry branch, throw
      `new BlockhashExpiredError()` instead of the generic `Error`; update the
      re-throw guard to re-throw when `e instanceof BlockhashExpiredError`
      (keep swallowing RPC-height-read errors). Leave the final genuine-timeout
      `throw new Error("… not confirmed within 90 s. It may still land — check
      Solana Explorer (devnet).")` exactly as-is. Keep the PDA fallback and
      blockheight logic otherwise unchanged.
      Files: `mobile/src/hooks/useMWA.ts`
      Verify: `npx jest src/hooks` — tests from item 5 covering "throws
      BlockhashExpiredError when height > lastValidBlockHeight and PDA absent"
      and "returns (no throw) when PDA exists" pass.

- [ ] 3. Rewrite `signAndBroadcast` to fetch the blockhash inside `transact()` and add a bounded fresh-blockhash retry, PDA-gated.
      In `src/hooks/useMWA.ts`:
      (a) Remove the pre-session `getLatestBlockhashWithFallback()` + the
      load-bearing comment; replace the comment with a short note citing the
      verified finding (fetch moved inside the session, independent channels).
      (b) Inside the `transact` callback: `await authorizeOrReauthorize(wallet)`,
      refresh `feePayer`, then **immediately** `const { blockhash,
      lastValidBlockHeight } = await getLatestBlockhashWithFallback();
      tx.recentBlockhash = blockhash;` with **no other await** before
      `wallet.signAndSendTransactions({ transactions:[tx], minContextSlot:0,
      skipPreflight:true })`. Return both the base58 sig (via existing
      `encodeBase58`, do NOT switch to bs58) and the `lastValidBlockHeight`
      captured in-session out of the callback.
      (c) Keep `signAndBroadcast`'s return type `{ sig: string;
      lastValidBlockHeight: number }` unchanged so the caller/persistence shape
      is untouched (the second-attempt retry is handled in item 4 at the caller,
      because the caller owns the AsyncStorage record and status messages).
      Do NOT change `buildCreateAndFundTx` or the `tx` instruction list; only
      reset `recentBlockhash`/`feePayer`.
      Files: `mobile/src/hooks/useMWA.ts`
      Verify: `npx tsc --noEmit` shows **no new** errors in `useMWA.ts` beyond
      the two pre-existing ones (lines ~93 encodeBase58 ArrayLike, ~151 setTimeout
      cast); diff-review confirms the `getLatestBlockhash` call sits between
      `authorize` and `signAndSendTransactions` with no intervening await.

- [ ] 4. Add the PDA-gated single retry in the caller flow in `CreateQuestScreen.tsx`, keeping the pending-record/resume architecture coherent.
      In `handleCreate`, wrap the sign→persist-sig→`waitForConfirmation` sequence
      in a 2-attempt loop. On attempt 1: as today. If `waitForConfirmation`
      throws `BlockhashExpiredError` (import it from `../hooks/useMWA`): first
      check the PDA — `const [pda] = questPda(publicKey, questId); const acct =
      await connection.getAccountInfo(pda);` (import `connection`, `questPda`
      from `../lib/solana`). If `acct` is non-null, treat as success (skip to
      Appwrite save). If null and attempt < 2, set status
      `"⚠️ Blockhash expired, retrying with a fresh one — please approve again
      in your wallet…"`, call `signAndBroadcast(tx)` again (this re-signs over a
      fresh blockhash per item 3), **overwrite** the `pending_quest_v1` record
      with the new `sig`/`lastValidBlockHeight` (keep `creator`,`questId`,
      `questData`), then `waitForConfirmation` again. If attempt 2 also throws
      `BlockhashExpiredError`, surface a clear final message. All other errors
      (on-chain failure, genuine non-expiry timeout) propagate to the existing
      `catch` unchanged, so the "It may still land — check Solana Explorer"
      wording still reaches the user on a true timeout. Ensure the pending record
      is removed on terminal failure exactly as today (the existing
      `removeItem` on reject stays).
      Keep `completePendingQuest` / `tryResumePendingQuest` as-is; they already
      read the (now possibly updated) record and are compatible because the
      record shape is unchanged.
      Files: `mobile/src/screens/CreateQuestScreen.tsx`
      Verify: `npx tsc --noEmit` shows no new errors in `CreateQuestScreen.tsx`;
      diff-review confirms: (i) retry bounded to 2 attempts, (ii) PDA checked
      before any re-prompt, (iii) pending record overwritten (not duplicated)
      between attempts, (iv) non-expiry errors still hit the original catch.

- [ ] 5. Add a self-contained unit test for the retry signal and PDA gate.
      Create `src/hooks/__tests__/useMWA.waitForConfirmation.test.ts`. Mock
      `../lib/solana` (so no real RPC/`@env`): stub `connection.getSignatureStatuses`,
      `connection.getAccountInfo`, `getCurrentBlockHeight`, and `questPda`.
      Cover: (a) height past `lastValidBlockHeight` + null status + null PDA →
      rejects with `BlockhashExpiredError` (assert by `name`); (b) PDA account
      present → resolves (no throw) even when status is null; (c) status
      `confirmed` → resolves; (d) status `err` set → rejects with a non-expiry
      error. Use fake timers to skip the 2 s poll waits. Do NOT import `App`,
      navigation, or `CreateQuestScreen`.
      Files: `mobile/src/hooks/__tests__/useMWA.waitForConfirmation.test.ts`
      Verify: `npx jest src/hooks` — all four cases pass.

- [ ] 6. Final cross-check of preserved invariants.
      Confirm by diff-review: `encodeBase58` untouched (no bs58 import added);
      `solana.ts` Helius-via-`@env` wiring unchanged (no `process.env`, no new
      RPC); `transactions.ts` `buildCreateAndFundTx` instruction logic untouched;
      `waitForConfirmation` still blockheight-aware with PDA fallback; genuine
      non-expiry timeout wording intact. No new runtime dependency added to
      `package.json` (jest `transformIgnorePatterns` / `@env` stub are
      dev/test-config only).
      Files: (review only) `mobile/src/hooks/useMWA.ts`,
      `mobile/src/lib/solana.ts`, `mobile/src/lib/transactions.ts`,
      `mobile/src/screens/CreateQuestScreen.tsx`, `mobile/package.json`
      Verify: `npx jest src/hooks` green; `git diff --stat` shows only the five
      intended files changed.

## Implementation results (recorded for the reviewer)

Implemented 2025 (first iteration — no `blockhash-review.json` present).

- **Blockhash fetch location:** moved INSIDE the `transact()` callback in
  `signAndBroadcast` (`src/hooks/useMWA.ts`), immediately after
  `authorizeOrReauthorize` and immediately before `signAndSendTransactions`,
  with no intervening `await`. `lastValidBlockHeight` is captured in-session via
  a closure var and returned, so the return shape
  `{ sig, lastValidBlockHeight }` is unchanged. Justification: per plan finding
  1(a), the dApp RPC and MWA session are independent channels; a sub-second HTTP
  blockhash fetch does not close the session. This cuts staleness to the
  irreducible approval duration.
- **Retryable signal:** added and exported `BlockhashExpiredError extends Error`
  (`name = "BlockhashExpiredError"`). `waitForConfirmation` now throws it on the
  blockheight-expiry branch instead of a generic Error; the re-throw guard uses
  `instanceof BlockhashExpiredError`. Blockheight-awareness + questPda
  `getAccountInfo` fallback are unchanged. The genuine non-expiry timeout still
  throws the plain Error with "It may still land — check Solana Explorer
  (devnet)."
- **Bounded, PDA-gated retry:** `CreateQuestScreen.handleCreate` wraps
  sign→persist→confirm in a 2-attempt loop. On `BlockhashExpiredError` it first
  checks `connection.getAccountInfo(questPda)` — if the PDA exists the first
  attempt landed, so it breaks to the save path (NEVER re-prompts, cannot
  double-fund). Only when the PDA is absent and attempt < 2 does it re-call
  `signAndBroadcast` (which re-signs over a fresh blockhash) and overwrite the
  `pending_quest_v1` record with the new sig/lastValidBlockHeight (creator,
  questId, questData unchanged). User sees "⚠️ Blockhash expired, retrying with a
  fresh one — please approve again in your wallet…". Non-expiry errors still
  propagate to the original catch.
- **Preserved invariants:** `encodeBase58` untouched (no bs58); `solana.ts`
  Helius-via-`@env` wiring unchanged (no diff); `transactions.ts`
  `buildCreateAndFundTx` instruction logic untouched by this change; AsyncStorage
  `pending_quest_v1` + AppState resume (`tryResumePendingQuest` /
  `completePendingQuest`, backward-compat) intact and record shape unchanged.
- **Tests:** added `src/hooks/__tests__/useMWA.waitForConfirmation.test.ts`
  (4 cases: expiry+PDA-absent → BlockhashExpiredError; PDA-present → resolves;
  confirmed status → resolves; on-chain err → non-expiry reject). Jest config
  widened (`transformIgnorePatterns` + `@env` stub, test-only) so the focused
  suite loads. `npx jest src/hooks` → 4 passed.
- **tsc:** `npx tsc --noEmit` introduces NO new errors in the touched source
  files. Remaining errors in `useMWA.ts` (encodeBase58 ArrayLike,
  setTimeout cast) and `CreateQuestScreen.tsx` (ngeohash, GeolocationPosition,
  Buffer, StatusBar backgroundColor) are the PRE-EXISTING baseline set (only
  line numbers shifted by added lines). The new test file is clean.

## Needs verification during implementation

- The exact set of packages that must be whitelisted in `transformIgnorePatterns`
  (item 1) can only be finalized by running the focused test and reading the
  first `Unexpected token 'export'` it reports; widen the pattern until the
  hooks test loads. The test is written to avoid the navigation stack precisely
  so this list stays small.
- Confirm during implementation that importing `useMWA.ts` under jest does not
  eagerly throw from the MWA native proxy. Import is expected to be safe (the
  proxy only throws on method access, not on module load); if a top-level import
  does throw, mock `@solana-mobile/mobile-wallet-adapter-protocol-web3js` in the
  test as well.
