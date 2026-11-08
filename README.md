# ProofQuest

**Real-world evidence on Solana. Verified. Trustless. Paid.**

ProofQuest is a mobile-first proof-and-payout protocol for real-world verification. A requester funds a quest with USDC locked in on-chain escrow, a nearby worker captures camera + GPS + time evidence and submits a signed proof packet, and the requester approves to release the reward — all from an Android phone, no browser, no custodial accounts.

Built for the [CLOCK IN — Solana Mobile Hackathon](https://solanamobile.radiant.nexus/) · Devnet demo · Oct 2026

---

## Demo

> Two devices, one quest, one payout.

1. Requester creates a verification quest and locks USDC in escrow (on-chain)
2. Nearby worker claims it, captures evidence in-app (camera + coarse GPS + timestamp)
3. Worker submits a SHA-256 signed proof packet — only the digest hits the chain
4. Requester reviews the proof and approves → USDC released from vault to worker

No raw location or photos are stored on-chain. Evidence stays private in Appwrite storage; only the manifest hash is recorded on Solana devnet.

---

## Architecture

```
Mobile app (React Native 0.87, Android)
  ├── MWA / Phantom  — wallet auth, tx signing (Mobile Wallet Adapter)
  ├── Helius RPC     — fast, reliable devnet transaction broadcast + confirmation
  ├── Anchor program — on-chain escrow, state machine, payout (Solana devnet)
  └── Appwrite       — quest discovery cache, private evidence storage, anonymous sessions

On-chain program (Anchor / Rust)
  ├── Quest PDA       ["quest", creator, quest_id]
  ├── Vault (SPL token account owned by quest PDA)
  └── Instructions: create_and_fund_quest · claim_quest · submit_evidence_hash
                    approve_and_release · cancel_unclaimed · refund_expired
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for full design details.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Mobile | React Native 0.87 · TypeScript · Hermes |
| Wallet | Solana Mobile Wallet Adapter (MWA) · Phantom |
| Chain | Anchor 0.32 · SPL Token · Solana devnet |
| RPC | Helius (devnet) |
| Storage | Appwrite (self-hosted) |
| Camera | react-native-vision-camera v5 (nitro) |
| Icons | react-native-svg (hand-authored icon set) |

---

## Quest Templates

Three built-in templates for common real-world checks:
- **Is this booth open?** — photo of entrance showing open/closed status
- **Did this poster go up?** — photo of poster in place at the specified location
- **Verify today's menu price** — photo of menu board showing item and price
- **Custom quest** — open-ended evidence requirement

---

## Getting Started

### Prerequisites

- Node ≥ 22.11.0 + npm
- JDK 17
- Android SDK (API 35, NDK)
- Android device or emulator with Phantom wallet installed
- [Helius](https://helius.dev) account (free devnet key)
- [Appwrite](https://appwrite.io) project (self-hosted or cloud)

### 1. Clone

```bash
git clone https://github.com/<your-handle>/ProofQuest.git
cd ProofQuest
```

### 2. Configure environment

```bash
cp mobile/.env.example mobile/.env
# Edit mobile/.env with your Helius RPC URL and Appwrite credentials
```

**Required values in `mobile/.env`:**
```
HELIUS_RPC_URL=https://devnet.helius-rpc.com/?api-key=<your-key>
APPWRITE_ENDPOINT=https://<your-appwrite-instance>/v1
APPWRITE_PROJECT_ID=<your-project-id>
APPWRITE_DATABASE_ID=proofquest
PROGRAM_ID=DmSc562EUuh9yvu2AmEupLLC8wQrXZGVSCZL61EpugvZ
TEST_USDC_MINT=<mint-address>
```

> ⚠️ **Security note:** `APPWRITE_API_KEY` is a server-side key. Do NOT put it in `mobile/.env` — it will be bundled into the APK and extractable. Appwrite writes from the mobile client use anonymous sessions only. The API key is only needed for the setup scripts.

### 3. Set up Appwrite

Create the database schema (collections, indexes, storage bucket):

```bash
cd appwrite
npm install
APPWRITE_ENDPOINT=https://... APPWRITE_PROJECT_ID=... APPWRITE_API_KEY=... node setup.js
```

### 4. Mint test USDC

Generate a creator and worker keypair, then seed them with test USDC:

```bash
# Requires Solana CLI
cd scripts
npm install
node setup-devnet.js <path/to/creator-keypair.json> <path/to/worker-keypair.json>
```

The script outputs the `TEST_USDC_MINT` address — add it to `mobile/.env`.

### 5. Install dependencies

```bash
cd mobile
npm install
```

### 6. Run (development)

```bash
# Start Metro bundler
npm start

# In a separate terminal — build and install on connected Android device
cd android && ./gradlew app:installDebug
adb reverse tcp:8081 tcp:8081
```

### 7. Build release APK

```bash
cd mobile/android
./gradlew app:assembleRelease
# APK: mobile/android/app/build/outputs/apk/release/app-release.apk
```

---

## On-chain Program

Program ID: `DmSc562EUuh9yvu2AmEupLLC8wQrXZGVSCZL61EpugvZ` (Solana devnet)

Source: [`program/programs/proof_quest/src/lib.rs`](program/programs/proof_quest/src/lib.rs)

### State transitions

```
Open → Claimed → Submitted → Approved
 ↓                           ↓
Cancelled              (after submit_deadline + 7d grace)
                             ↓
                          Refunded
```

### Run Anchor tests

```bash
cd program
anchor test
```

---

## Evidence Manifest

Each submission builds a canonical JSON manifest before hashing:

```json
{
  "questAddress": "...",
  "workerWallet": "...",
  "captureTimestamp": 1234567890,
  "coarseLocation": { "geohash": "tutq", "accuracy": 15.5 },
  "nonce": "uuid-v4",
  "qrChallengeResult": null,
  "mediaSha256": "...",
  "storageObjectId": "...",
  "appVersion": "1.0"
}
```

Keys are sorted, the string is UTF-8 encoded, SHA-256 hashed, and the 32-byte digest is stored on-chain via `submit_evidence_hash`. The raw photo and exact coordinates stay in private Appwrite storage — only the verifiable digest is public.

---

## Known Limits (Devnet Demo)

- Devnet only — not production ready
- Phantom shows "Unknown Program" for the custom escrow contract (expected for unregistered devnet programs)
- No push notifications (local status messages only)
- QR challenge field is in the manifest schema but not yet captured in-app
- GPS can be spoofed; the app uses coarse geohash for privacy, not proof-of-presence

---

## Repo Structure

```
ProofQuest/
├── mobile/              # React Native Android app
│   ├── src/
│   │   ├── screens/     # WelcomeScreen, HomeScreen, CreateQuestScreen,
│   │   │                #   QuestDetailScreen, CaptureScreen, ReviewScreen
│   │   ├── hooks/       # useMWA (MWA sign+broadcast, blockheight confirmation)
│   │   ├── lib/         # solana.ts, transactions.ts, appwrite.ts, manifest.ts
│   │   ├── store/       # Zustand wallet store
│   │   ├── theme/       # Design tokens (colors, spacing, radii, typography)
│   │   └── ui/          # Shared primitives (Button, Card, Badge, Icon, Modal, Toast)
│   ├── .env.example     # Environment template (copy to .env)
│   └── android/         # Android project
├── program/             # Anchor / Rust escrow program
│   └── programs/proof_quest/src/lib.rs
├── appwrite/            # Appwrite schema setup script
│   └── setup.js
├── scripts/             # Devnet token mint + seeding
│   └── setup-devnet.js
└── docs/                # Architecture, PRD, research
```

---

## License

MIT
