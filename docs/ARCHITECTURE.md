Technical design
Client
React Native Android app using TypeScript, Solana Mobile Wallet Adapter and native camera, geolocation and QR modules. Use a development build, not a thin WebView. Keep wallet signing explicit at fund, claim, submit and settle.

Program
Small Anchor program with a quest account and program-controlled token vault. Keep evidence verification off-chain; the chain enforces ownership, state transitions, expiry and payment.

Quest PDA
["quest", creator, quest_id]
Vault
SPL token account owned by quest authority PDA
Token
Dedicated test mint labelled clearly as test USDC
Network
Devnet for submission demo
Evidence
Private object storage; digest and minimal metadata on-chain
Quest account fields
version, creator, worker (optional), mint, reward_amount, status, created_at, claim_deadline, submit_deadline, coarse_geohash or area id, evidence_schema_hash, evidence_manifest_hash, submitted_at and bump.

Instructions
create_and_fund_quest, claim_quest, submit_evidence_hash, approve_and_release, cancel_unclaimed and refund_expired. Close token vault and quest only after a terminal state if rent recovery is worth the extra test surface.

Evidence manifest
Canonical JSON: quest address, worker wallet, capture timestamp, coarse location, device-generated nonce, QR challenge result, media SHA-256, storage object id and app version. Sort keys and define byte encoding before hashing. Worker signs the digest. The program stores only the 32-byte digest.

Stack
Mobile
React Native + TypeScript; Solana Mobile Wallet Adapter; native camera / QR / location modules
Chain
Anchor / Rust, SPL Token or Token-2022 only if already proven in your stack
Data
Supabase for quest discovery cache, private media bucket and signed review URLs
Integrity
SHA-256 canonical manifest; wallet signature; on-chain digest
Testing
Anchor tests for every state transition; Android end-to-end smoke script on two wallets
Observability
Capture step timing, failures and completed quest count without raw location analytics
Threats and safety
GPS spoofing
Use coarse location plus live QR or requester challenge. Never claim spoof-proof location.
Photo replay
In-app capture only, nonce in manifest, optional QR in frame, reject duplicate media hashes.
Privacy
Ask only foreground location; store coarse area publicly; private media with expiring URLs; deletion policy in the deck.
Unsafe tasks
Allow only public-place verification templates; ban surveillance, trespass, faces, IDs, residences and illegal tasks.
Disputes
MVP is requester-approved payment. Show that clearly before claim; use a seeded honest demo, not fake decentralised arbitration.
Regulation
Devnet only for the hackathon. Real launch needs review of marketplace terms, worker classification, sanctions/KYC, tax and money-transmission exposure by jurisdiction.
Cold start
Do not launch a global marketplace. Seed one event/community with repeat quests and known testers.
Prepared 22 Sep 2026. No repo, account or submission was created.