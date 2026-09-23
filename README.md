# ProofQuest

> Request trusted real-world evidence, get a signed proof packet, release USDC when you approve.

Built for the [CLOCK IN Solana Mobile Hackathon](https://solanamobile.com/blog/clock-in-the-solana-mobile-hackathon).

---

## What it does

A requester posts a quest with a USDC bounty locked in an on-chain escrow. A worker claims the quest, goes to the physical location, captures photo/video evidence, and submits a SHA-256 manifest hash on-chain. The requester reviews the proof and releases the funds — all from an Android phone using a MWA-compatible wallet (Phantom / Solflare).

---

## Repo layout

```
program/    Anchor escrow program (Rust)
mobile/     React Native Android app (TypeScript)
appwrite/   DB + storage setup script
scripts/    Devnet helpers (mint USDC, seed quests)
```

---

## Stack

| Layer | Tech |
|---|---|
| Blockchain | Solana devnet, Anchor 0.32.1 |
| Mobile | React Native 0.79, MWA, Zustand |
| Backend | Appwrite (self-hosted 1.9.0) |
| Wallet | Phantom / Solflare (MWA) |

---

## Prerequisites

- Solana CLI 1.18+, Anchor 0.32, Rust stable
- Node 22, Yarn 1.22
- Android SDK API 33+, NDK 27.0, physical Android device with Phantom or Solflare
- Appwrite project (cloud or self-hosted)

---

## Quick start

### 1. Program

```bash
cd program
anchor build
anchor test
```

### 2. Appwrite setup

```bash
cd appwrite
APPWRITE_PROJECT_ID=xxx APPWRITE_API_KEY=xxx node setup.js
```

Creates the `proofquest` database, `quests` + `evidence_manifests` collections, indexes, and `evidence` storage bucket.

### 3. Mobile

```bash
cd mobile
cp .env.example .env   # fill in values
yarn install
yarn android           # requires connected Android device
```

---

## Environment

`mobile/.env`:

```
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=
APPWRITE_DATABASE_ID=proofquest
PROGRAM_ID=DmSc562EUuh9yvu2AmEupLLC8wQrXZGVSCZL61EpugvZ
TEST_USDC_MINT=
```

---

## Program instructions

| Instruction | Who calls it |
|---|---|
| `create_and_fund_quest` | Requester — creates PDA + locks USDC |
| `claim_quest` | Worker — locks in on the quest |
| `submit_evidence_hash` | Worker — posts SHA-256 manifest hash |
| `approve_and_release` | Requester — releases USDC to worker |
| `cancel_unclaimed` | Requester — cancels before anyone claims |
| `refund_expired` | Requester — refund after deadline passes |

Program ID (devnet): `DmSc562EUuh9yvu2AmEupLLC8wQrXZGVSCZL61EpugvZ`

---

## Known limits (MVP)

- Devnet only — no mainnet custody
- Requester-approved payout — no on-chain arbitration
- Android only — no iOS MWA support yet
