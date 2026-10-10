# ProofQuest

**Real-world evidence on Solana. Verified. Trustless. Paid.**

ProofQuest is a mobile-first proof-and-payout protocol for real-world verification built on Solana. A requester locks USDC in an on-chain escrow, a nearby worker captures camera + GPS + timestamp evidence, submits a signed proof packet, and the requester approves to release the reward — entirely from an Android phone, no browser, no custodial account.

Built for the **[CLOCK IN — Solana Mobile Hackathon](https://solanamobile.radiant.nexus/)** · Devnet · Oct 2026

---

## Download APK

**[ProofQuest-v1.0.1.apk](https://github.com/iamaanahmad/proofquest/releases/download/v1.0.1/ProofQuest-v1.0.1.apk)** — latest release

Requirements: Android 10+, [Phantom](https://phantom.app/) wallet installed, Solana devnet SOL for fees.

---

## Demo Flow

Two wallets, one phone, one trustless payout loop:

1. **Connect creator wallet** (requester role) → Create quest → Set reward + claim window → Fund & Publish → USDC locked in on-chain escrow
2. **Disconnect → connect worker wallet** → Nearby quests list → Claim quest → Capture evidence in-app (camera + coarse GPS + timestamp)
3. Worker submits → SHA-256 signed manifest stored in Appwrite, 32-byte digest written on-chain
4. **Disconnect → reconnect creator** → Review Proof (hash verified, evidence photo, metadata) → Approve & Release USDC → reward transferred from vault to worker

No raw location or photo ever touches the chain. Only the manifest hash is public.

---

## Architecture

```
Mobile app (React Native 0.87 · Android · TypeScript · Hermes)
  ├── MWA / Phantom       — wallet auth + transaction signing
  ├── Helius RPC          — reliable devnet broadcast + confirmation
  ├── Anchor program      — on-chain escrow state machine + SPL vault
  └── Appwrite            — quest discovery cache · private evidence storage

On-chain program  DmSc562EUuh9yvu2AmEupLLC8wQrXZGVSCZL61EpugvZ  (Solana devnet)
  ├── Quest PDA           ["quest", creator, quest_id]
  ├── Vault               SPL token account owned by quest PDA
  └── Instructions
        create_and_fund_quest   — create quest + move USDC into vault
        claim_quest             — worker locks the quest to their wallet
        submit_evidence_hash    — write 32-byte manifest digest on-chain
        approve_and_release     — transfer vault → worker ATA
        cancel_unclaimed        — creator cancels open quest, reclaims escrow
        refund_expired          — anyone triggers refund after deadline passes
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full technical design.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Mobile | React Native 0.87 · TypeScript · Hermes engine |
| Wallet | Solana Mobile Wallet Adapter (MWA) · Phantom |
| Chain | Anchor 0.32 · SPL Token · Solana devnet |
| RPC | Helius devnet |
| Backend | Appwrite (self-hosted) |
| Camera | react-native-vision-camera v5 (nitro architecture) |
| Icons | react-native-svg — hand-authored SVG icon set |
| State | Zustand |

---

## Quest Templates

Three built-in verification templates:
- **Is this booth open?** — photo of entrance showing open/closed status
- **Did this poster go up?** — photo of poster in the specified location
- **Verify today's menu price** — photo of menu board showing item + price
- **Custom** — open-ended evidence requirement

---

## Getting Started

### Prerequisites

- Node ≥ 22.11.0 + npm
- JDK 17
- Android SDK (API 35) + NDK
- Android device with [Phantom](https://phantom.app/) wallet installed
- [Helius](https://helius.dev) free devnet API key
- [Appwrite](https://appwrite.io) project (cloud or self-hosted)

### 1. Clone

```bash
git clone https://github.com/iamaanahmad/proofquest.git
cd proofquest
```

### 2. Environment

```bash
cp mobile/.env.example mobile/.env
# Fill in your values — see .env.example for all required keys
```

Key variables:
```
HELIUS_RPC_URL=https://devnet.helius-rpc.com/?api-key=<your-key>
APPWRITE_ENDPOINT=https://<your-appwrite>/v1
APPWRITE_PROJECT_ID=<project-id>
APPWRITE_DATABASE_ID=proofquest
PROGRAM_ID=DmSc562EUuh9yvu2AmEupLLC8wQrXZGVSCZL61EpugvZ
TEST_USDC_MINT=<from-setup-devnet>
```

> ⚠️ `APPWRITE_API_KEY` is a server-side key — do **not** put it in `mobile/.env`. It gets bundled into the APK. Use it only in the setup scripts.

### 3. Set up Appwrite schema

```bash
cd appwrite && npm install
APPWRITE_ENDPOINT=... APPWRITE_PROJECT_ID=... APPWRITE_API_KEY=... node setup.js
```

### 4. Mint test USDC

```bash
cd scripts && npm install
# Requires Solana CLI — generates TEST_USDC_MINT address
node setup-devnet.js <creator-keypair.json> <worker-keypair.json>
```

### 5. Install dependencies

```bash
cd mobile && npm install
```

### 6. Run in development

```bash
# Terminal 1 — Metro bundler
cd mobile && npm start

# Terminal 2 — build + install on connected Android device
cd mobile/android && ./gradlew app:installDebug
adb reverse tcp:8081 tcp:8081
```

### 7. Build release APK

```bash
cd mobile/android && ./gradlew app:assembleRelease
# Output: mobile/android/app/build/outputs/apk/release/app-release.apk
```

---

## On-chain Program

**Program ID:** `DmSc562EUuh9yvu2AmEupLLC8wQrXZGVSCZL61EpugvZ` (Solana devnet)

Source: [`program/programs/proof_quest/src/lib.rs`](program/programs/proof_quest/src/lib.rs)

State machine:
```
Open  →  Claimed  →  Submitted  →  Approved
 ↓                                     
Cancelled          (Refunded after submit_deadline passes)
```

Run Anchor tests:
```bash
cd program && anchor test
```

---

## Evidence Manifest

Every submission produces a canonical JSON manifest before hashing:

```json
{
  "questAddress":      "...",
  "workerWallet":      "...",
  "captureTimestamp":  1234567890,
  "coarseLocation":    { "geohash": "tutq", "accuracy": 15.5 },
  "nonce":             "uuid-v4",
  "qrChallengeResult": null,
  "mediaSha256":       "...",
  "storageObjectId":   "...",
  "appVersion":        "1.0"
}
```

Keys are sorted, UTF-8 encoded, SHA-256 hashed, and the 32-byte digest is stored on-chain via `submit_evidence_hash`. The raw photo and exact coordinates stay in private Appwrite storage — only the verifiable digest is public.

---

## Project Structure

```
proofquest/
├── mobile/                    # React Native Android app
│   ├── src/
│   │   ├── screens/           # All 6 screens (Welcome, Home, CreateQuest,
│   │   │                      #   QuestDetail, Capture, Review)
│   │   ├── hooks/             # useMWA — sign+broadcast, blockheight confirmation
│   │   ├── lib/               # solana.ts · transactions.ts · appwrite.ts · manifest.ts
│   │   ├── store/             # Zustand wallet store
│   │   ├── theme/             # Design tokens (colors, spacing, radii, typography)
│   │   └── ui/                # Shared primitives: Button, Card, Badge, Icon,
│   │                          #   ScreenHeader, Screen, Modal/Toast (FeedbackProvider)
│   ├── .env.example           # Environment template — copy to .env
│   └── android/               # Android project
├── program/                   # Anchor / Rust escrow program
│   └── programs/proof_quest/src/lib.rs
├── appwrite/                  # Appwrite schema setup script
│   └── setup.js
├── scripts/                   # Devnet token mint + wallet seeding
│   └── setup-devnet.js
└── docs/
    └── ARCHITECTURE.md        # Full technical design
```

---

## Known Limits

- **Devnet only** — not production ready, uses test USDC
- **"Unknown Program"** in Phantom — expected for unregistered devnet programs
- **"Unknown Token"** in Phantom wallet — custom SPL mint has no Metaplex metadata; add the mint address manually to see balance (`DnDYB6ogihxG4uegoQ4dGWfXcf7TjrkqxPKPrbg1qw87`)
- **QR challenge** — field is in the manifest schema and displayed in Review, but in-app QR capture is not yet implemented
- **No push notifications** — status updates are in-app only

---

## Releases

| Version | Notes |
|---------|-------|
| [v1.0.1](https://github.com/iamaanahmad/proofquest/releases/tag/v1.0.1) | Fixed Review Proof screen manifest loading |
| [v1.0.0](https://github.com/iamaanahmad/proofquest/releases/tag/v1.0.0) | Initial submission build |

---

## License

MIT
