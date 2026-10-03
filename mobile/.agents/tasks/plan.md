# Implementation Plan — ProofQuest reliability fix (env wiring + stale-blockhash/confirmation)

Scope: mobile client only, all work in `c:\Projects\ProofQuest\mobile`. Do NOT modify the Solana program. Do NOT change Appwrite logic beyond adding `@env` type declarations. Preserve the AsyncStorage pending-quest + AppState resume architecture in CreateQuestScreen.tsx. All commands below run with cwd = `c:\Projects\ProofQuest\mobile`.

## Design decisions (grounded in the code read)

- **Env mechanism = react-native-dotenv** (user's explicit choice). It is a Babel plugin; it rewrites `import { X } from "@env"` to the literal `.env` value at build time, so values reach Hermes without a runtime `process.env`. This is why `process.env.PROGRAM_ID` currently resolves to `undefined` — there is no plugin reading `.env`.
- **Preserve module-resolver.** `babel.config.js` currently has exactly one plugin: `['module-resolver', { alias: { crypto, stream, buffer } }]`. The dotenv plugin is ADDED to the `plugins` array alongside it; the module-resolver entry is left byte-for-byte unchanged. Plugin order does not matter here (different concerns), append dotenv after module-resolver.
- **No test framework for these modules.** Only `__tests__/App.test.tsx` (default) exists; `jest` + `@react-native/jest-preset` are installed. We will NOT author unit tests for native-bridge-heavy code (MWA/web3 transact cannot run under jest without heavy mocking and is out of scope). Verification is: TypeScript typecheck (`npx tsc --noEmit`), lint (`npm run lint`), and the existing jest suite (`npm test`) staying green. This is the project's real, runnable signal on Windows without an emulator.
- **Blockhash expiry fix** = fetch `{ blockhash, lastValidBlockHeight }` as late as possible (immediately before `transact()`, keeping the MWA-session constraint: no network calls INSIDE the session after authorize), thread `lastValidBlockHeight` to confirmation, and make confirmation blockheight-aware via `getBlockHeight` plus a quest-PDA `getAccountInfo` fallback.
- **PDA fallback.** `questPda(creator, questId)` is deterministic. If `getAccountInfo(questPda)` is non-null, the fund succeeded regardless of lagging signature status — treat as success. CreateQuestScreen already computes `questPdaKey` and has `publicKey`/`questId`.
- **Backward-compat for persisted records.** Current AsyncStorage record under key `pending_quest_v1` is `{ sig, questData }`. New records add `lastValidBlockHeight`, `creator`, `questId`. Old records (missing these) must still confirm — the new `waitForConfirmation` treats a missing `lastValidBlockHeight` as "blockheight check disabled" and a missing creator/questId as "PDA fallback disabled", falling back to signature-status polling with the existing overall timeout.

---

## Part 1 — Wire up `.env` via react-native-dotenv

- [ ] 1. Install `react-native-dotenv` as a pinned devDependency.
      Run from cwd `c:\Projects\ProofQuest\mobile`: `npm install --save-dev --save-exact react-native-dotenv@5.0.0` (pin exact; `5.0.0` is the current `latest` on npm and declares NO peerDependencies, so there is no RN 0.87 conflict). If `5.0.0` fails to resolve or install, pin the exact latest version `npm view react-native-dotenv version` reports and record the chosen version in the step output — do NOT use a caret/open range. Confirm `package.json` devDependencies shows `"react-native-dotenv": "5.0.0"` (no `^`).
      Files: `package.json`, `package-lock.json`
      Verify: `npm ls react-native-dotenv` prints the pinned version with no `UNMET`/`invalid` errors.

- [ ] 2. Add the dotenv Babel plugin while preserving module-resolver exactly.
      Edit `babel.config.js` so `plugins` contains BOTH the existing `module-resolver` entry (unchanged — same aliases crypto/stream/buffer) AND a new entry:
      `['module:react-native-dotenv', { moduleName: '@env', path: '.env', safe: false, allowUndefined: true }]`.
      Keep `presets: ['module:@react-native/babel-preset']` unchanged.
      Files: `babel.config.js`
      Verify: `node -e "require('./babel.config.js')"` exits 0 (file is valid JS); visually confirm the module-resolver block is identical to before and dotenv is a sibling entry.

- [ ] 3. Create the `@env` TypeScript declaration file.
      Create `env.d.ts` at the mobile root declaring `module "@env"` with exported `const` strings: `HELIUS_RPC_URL`, `PROGRAM_ID`, `TEST_USDC_MINT`, `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `APPWRITE_DATABASE_ID`, `APPWRITE_API_KEY` (each `export const NAME: string;`).
      `tsconfig.json` uses `"include": ["**/*.ts", "**/*.tsx"]`, so a root `env.d.ts` is picked up automatically — no tsconfig edit needed. Do NOT edit tsconfig.json.
      Files: `env.d.ts`
      Verify: `npx tsc --noEmit` succeeds (the new declaration resolves and does not introduce errors).

- [ ] 4. Consume env values in `src/lib/solana.ts`.
      Add `import { HELIUS_RPC_URL, PROGRAM_ID as ENV_PROGRAM_ID, TEST_USDC_MINT as ENV_TEST_USDC_MINT } from "@env";` at the top.
      - Build the RPC url as: use `HELIUS_RPC_URL` when it is a non-empty string, else fall back to the existing `DEVNET_RPC` (`https://api.devnet.solana.com`). Keep `DEVNET_RPC` exported. Pass the chosen url into `new Connection(...)` (keep the existing options object: commitment "confirmed", confirmTransactionInitialTimeout 60000, disableRetryOnRateLimit false).
      - Replace `process.env.PROGRAM_ID` with `ENV_PROGRAM_ID` and `process.env.TEST_USDC_MINT` with `ENV_TEST_USDC_MINT` in the two `new PublicKey(... ?? "hardcoded")` lines, keeping the exact existing hardcoded fallback addresses so the app never crashes when env is unset.
      - Leave `getLatestBlockhashWithFallback`, `questPda`, `vaultPda`, `getProgram`, seeds unchanged in this step (blockhash shape change happens in Part 2).
      Files: `src/lib/solana.ts`
      Verify: `npx tsc --noEmit` succeeds; `npm run lint` reports no new errors for `src/lib/solana.ts`.

---

## Part 2 — Fix stale-blockhash + confirmation reliability

- [ ] 5. Make `getLatestBlockhashWithFallback` return blockheight info and add a block-height helper in `src/lib/solana.ts`.
      - Change `getLatestBlockhashWithFallback()` to return the full result of `connection.getLatestBlockhash("confirmed")` (which already includes `{ blockhash, lastValidBlockHeight }`) — update its implicit/explicit return so callers can read `lastValidBlockHeight`. (It already returns that object; make the type explicit as `Promise<{ blockhash: string; lastValidBlockHeight: number }>` so downstream typing is clear.)
      - No new helper is strictly required for `getBlockHeight` (callers can use `connection.getBlockHeight("confirmed")` directly), but you MAY add `export async function getCurrentBlockHeight() { return connection.getBlockHeight("confirmed"); }` for readability. If added, use it consistently in step 6.
      Files: `src/lib/solana.ts`
      Verify: `npx tsc --noEmit` succeeds.

- [ ] 6. Rewrite `signAndBroadcast` and `waitForConfirmation` in `src/hooks/useMWA.ts`.
      Preserve: the self-contained `encodeBase58` (do NOT switch to bs58), `authorizeOrReauthorize`, `APP_IDENTITY`, `useMWA()` hook, and the "no network calls inside the MWA session after authorize" constraint.

      6a. `signAndBroadcast(tx: Transaction)` — change the return type to `Promise<{ sig: string; lastValidBlockHeight: number }>`.
      - Keep `tx.feePayer = publicKey`.
      - Fetch `{ blockhash, lastValidBlockHeight } = await getLatestBlockhashWithFallback()` IMMEDIATELY before `transact(...)` (as late as possible, still outside the session) and set `tx.recentBlockhash = blockhash`. Update the existing comment to note we also capture `lastValidBlockHeight` for blockheight-aware confirmation.
      - Keep the `transact(async (wallet) => { ... })` body exactly as-is (authorize, refresh feePayer, `signAndSendTransactions({ transactions:[tx], minContextSlot:0, skipPreflight:true })`, return `signatures[0]`). No network calls added inside the session.
      - After encoding, `return { sig: encodeBase58(new Uint8Array(rawSig)), lastValidBlockHeight };`.

      6b. `waitForConfirmation` — new signature:
      `waitForConfirmation(sig: string, opts?: { lastValidBlockHeight?: number; creator?: PublicKey; questId?: bigint }): Promise<void>`.
      Logic (poll loop, ~2s interval, keep an overall safety cap of 45 attempts so it can never hang forever):
      - Each iteration: `await connection.getSignatureStatuses([sig])`. On RPC throw, `continue`.
      - If `status.err` → throw immediately `Transaction failed on-chain: ${JSON.stringify(status.err)}`.
      - If `status.confirmationStatus` is `"confirmed"` or `"finalized"` → return (success).
      - PDA fallback (only when `opts.creator` and `opts.questId` are both provided): compute `[pda] = questPda(creator, questId)` once before the loop (import `questPda` from `../lib/solana`); each iteration also `await connection.getAccountInfo(pda)` — if non-null, return (success). Wrap in try/catch and ignore errors so it never breaks the loop.
      - Blockheight expiry (only when `opts.lastValidBlockHeight` is a number): each iteration `await connection.getBlockHeight("confirmed")` (or `getCurrentBlockHeight()` if added in step 5); if `currentHeight > lastValidBlockHeight` AND the signature is still not visible/confirmed AND the PDA fallback (if enabled) is still null → throw `Transaction expired (blockhash no longer valid) — please try again.` Guard the getBlockHeight call in try/catch; a failed height read should not throw, just skip the expiry check this iteration.
      - Final fallback (loop exhausts without success/expiry) → throw the ORIGINAL wording: `Transaction ${sig} not confirmed within 90 s. It may still land — check Solana Explorer (devnet).`
      - Keep imports tidy: add `PublicKey` is already imported; add `questPda` to the existing `../lib/solana` import line.
      Files: `src/hooks/useMWA.ts`
      Verify: `npx tsc --noEmit` succeeds; `npm run lint` reports no new errors for `src/hooks/useMWA.ts`.

- [ ] 7. Update `src/screens/CreateQuestScreen.tsx` call sites, the pending record, and the resume path.
      Preserve the whole AsyncStorage + AppState resume architecture; only adapt data threaded through it.
      - In `handleCreate`:
        - Change `let sig: string;` + `sig = await signAndBroadcast(tx);` to capture the object:
          `let signResult: { sig: string; lastValidBlockHeight: number };` then `signResult = await signAndBroadcast(tx);` and derive `const sig = signResult.sig;` (keep the existing reject/clear-pending try/catch unchanged).
        - When persisting after signing, write the enriched record:
          `await AsyncStorage.setItem(PENDING_QUEST_KEY, JSON.stringify({ sig, lastValidBlockHeight: signResult.lastValidBlockHeight, creator: publicKey.toBase58(), questId: questId.toString(), questData }));`
          (The initial pre-sign write stays `{ sig: null, questData }`.)
        - Change the inline confirmation call to pass opts:
          `await waitForConfirmation(sig, { lastValidBlockHeight: signResult.lastValidBlockHeight, creator: publicKey, questId });`
      - In `completePendingQuest(pending)`:
        - Reconstruct opts with backward-compat: `lastValidBlockHeight = typeof pending.lastValidBlockHeight === "number" ? pending.lastValidBlockHeight : undefined`; `creator = pending.creator ? new PublicKey(pending.creator) : undefined`; `questId = pending.questId ? BigInt(pending.questId) : undefined`.
        - Call `await waitForConfirmation(pending.sig, { lastValidBlockHeight, creator, questId });` then the existing `ensureAppwriteSession` / `insertQuest` / `removeItem` steps unchanged.
        - Add `import { PublicKey } from "@solana/web3.js";` (needed to rebuild creator). `questPda`/`TEST_USDC_MINT` import stays.
      Files: `src/screens/CreateQuestScreen.tsx`
      Verify: `npx tsc --noEmit` succeeds; `npm run lint` reports no new errors for the screen.

- [ ] 8. Full typecheck, lint, and existing-test gate.
      Run from cwd `c:\Projects\ProofQuest\mobile`:
      - `npx tsc --noEmit` → no errors.
      - `npm run lint` → no new errors introduced by the changes (pre-existing warnings in untouched files are acceptable; note any in the step output).
      - `npm test` → the existing `__tests__/App.test.tsx` suite passes.
      Files: none (verification only)
      Verify: all three commands succeed as above. If `tsc`/lint flags issues in the changed files, fix them before marking done.

---

## Backward-compat / edge-case notes for the implementer
- `transactions.ts` `buildCreateAndFundTx` instruction-building logic is NOT changed. It does call `connection.getAccountInfo(creatorAta)` during build — that stays; it runs before `signAndBroadcast`, outside any MWA session, so it is unaffected by the blockhash timing fix.
- Do not set `tx.lastValidBlockHeight` on the legacy `Transaction` just to carry the value; thread it explicitly through the return value and the AsyncStorage record as described (legacy `Transaction` doesn't need it for `signAndSendTransactions`).
- `.env` currently contains a live `APPWRITE_API_KEY` and a Helius key. Do not echo these values in step output or commits. `.env` is already in the repo per the user; do not add/remove it from git in this task.
- Keep `DEVNET_RPC` exported from `solana.ts` even after switching the Connection to Helius — it is the documented fallback and may be referenced.

---

## VERIFICATION (recorded by implementer)

Environment: Windows, PowerShell, cwd `c:\Projects\ProofQuest\mobile`. No emulator run (orchestrator runs the app).

### What was done
- **Part 1.1 — Install:** `npm install --save-dev --save-exact react-native-dotenv@5.0.0`. `npm ls react-native-dotenv` → `react-native-dotenv@5.0.0` (no UNMET/invalid). `package.json` devDependencies shows `"react-native-dotenv": "5.0.0"` (pinned, no caret).
- **Part 1.2 — babel.config.js:** Preserved the `module-resolver` entry byte-for-byte (aliases crypto/stream/buffer) and appended `['module:react-native-dotenv', { moduleName: '@env', path: '.env', safe: false, allowUndefined: true }]`. `node -e "require('./babel.config.js')"` → `babel ok` (exit 0).
- **Part 1.3 — env.d.ts:** Created at mobile root declaring `module "@env"` with the 7 required string consts. Picked up by tsconfig `"include": ["**/*.ts","**/*.tsx"]` (no tsconfig edit).
- **Part 1.4 — solana.ts:** Imports `{ HELIUS_RPC_URL, PROGRAM_ID as ENV_PROGRAM_ID, TEST_USDC_MINT as ENV_TEST_USDC_MINT } from "@env"`. Connection uses `HELIUS_RPC_URL` when a non-empty string, else `DEVNET_RPC`. Hardcoded PublicKey fallbacks kept. `DEVNET_RPC`, seeds, `questPda`, `vaultPda`, `getProgram` unchanged.
- **Part 2 — reliability:** `getLatestBlockhashWithFallback` now typed `Promise<{ blockhash; lastValidBlockHeight }>`; added `getCurrentBlockHeight`. `signAndBroadcast` fetches the blockhash immediately before `transact()` (no RPC inside the session) and returns `{ sig, lastValidBlockHeight }`. `waitForConfirmation(sig, { lastValidBlockHeight?, creator?, questId? })` polls `getSignatureStatuses` (confirmed/finalized = success, throws on `status.err`), adds a `questPda` `getAccountInfo` success fallback, and a `getBlockHeight` expiry check that throws "Transaction expired (blockhash no longer valid) — please try again." The final-timeout wording ("It may still land — check Solana Explorer (devnet)") is preserved only for the genuine timeout. `encodeBase58` kept (not bs58). CreateQuestScreen threads the new return/opts through the inline flow and the `pending_quest_v1` AsyncStorage record (now stores `lastValidBlockHeight`, `creator`, `questId`), with backward-compat in `completePendingQuest` for records missing those fields.

### Commands run and results
- `npx tsc --noEmit` → still reports pre-existing project errors ONLY (missing `@types/node` → `Buffer`; missing `ngeohash`/`GeolocationPosition` types; `StatusBar backgroundColor`; `Camera`/`alert`/`multiRemove`; and the identical `new Uint8Array(rawSig)` / `new Promise((r)=>...)` strictness errors that existed on the same expressions before). **No `TS2307` for `@env`** — the import resolves via `env.d.ts`. The two `process.env` errors previously in `solana.ts` are GONE. No NEW error class was introduced by these changes.
- `node -e "require('./babel.config.js')"` → `babel ok`.
- `npx eslint src/hooks/useMWA.ts src/lib/solana.ts src/screens/CreateQuestScreen.tsx env.d.ts` → only pre-existing findings: `no-bitwise` warnings inside the preserved `encodeBase58`, and `exhaustive-deps`/`radix`/`inline-style` on pre-existing (unmodified) CreateQuestScreen code. Nothing in newly authored code.
- `npm test` → the default `__tests__/App.test.tsx` fails at `import { NavigationContainer } from "@react-navigation/native"` (ESM `SyntaxError: Unexpected token 'export'`, a jest `transformIgnorePatterns` config gap in the default scaffold). Pre-existing and unrelated to these files.
- Grep confirms `solana.ts` no longer references `process.env` and consumes `HELIUS_RPC_URL` from `@env`; `babel.config.js` contains BOTH `module-resolver` (unchanged aliases) and `module:react-native-dotenv`.

### Rebuild requirement (important)
react-native-dotenv inlines `.env` values at BUILD time. The app must be rebuilt and Metro restarted with cache reset for the new Babel plugin and `.env` values to take effect:
`npm start -- --reset-cache` then rebuild the Android app. A real device run of the Fund & Publish flow is the ultimate validation and is outside this step's reach.

---

## Known gaps / assumptions
- No emulator/device run is part of verification (Windows, no Android build here). The runnable signal is typecheck + lint + jest. A real device run of the Fund & Publish flow is the ultimate validation but is outside this step's reach; call that out when handing off.
- `react-native-dotenv@5.0.0` is the pinned version (verified as npm `latest`, zero peerDependencies). If install fails, the implementer pins the exact latest version npm reports and records it (step 1). v2+ uses the `module:react-native-dotenv` plugin form with `moduleName` — which is exactly what step 2 specifies.
