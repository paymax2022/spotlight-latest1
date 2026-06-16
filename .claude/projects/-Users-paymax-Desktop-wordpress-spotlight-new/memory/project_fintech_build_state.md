---
name: fintech-build-state
description: Current state of the Paymax x Spotlight super-app build — v1 blocks done (Next.js), v2 playbook Go backend P1+P2 started
metadata:
  type: project
---

## Build playbook version
- **v1 (docs/build-playbook.md)**: Blocks 0-12 done in Next.js `frontend-web/`. Source of truth for the existing financial API.
- **v2 (PAYMAX_BUILD_PLAYBOOK.md)**: New playbook executed from 2026-06-16. Go backend becomes system of record; Next.js routes stay live during migration.

## v1 Blocks completed (all in Next.js / Supabase)

| Block | Description | Status |
|---|---|---|
| 0 | Golden-path E2E baseline (40 tests) | ✅ |
| 1 | Platform scaffold, feature flags, openapi.yaml | ✅ |
| 2 | KYC schema + state machine | ✅ |
| 3 | Ledger schema + wallet_balance VIEW | ✅ |
| 4 | Wallet service (topup, balance, transactions) | ✅ |
| 5 | Virtual accounts (Paystack DVA) | ✅ |
| 6 | Vote bridge (idempotent, KYC gate, outbox) | ✅ |
| 7 | Tier limits (atomic debit RPC, fail-closed) | ✅ |
| 8 | Referrals (at-most-once, outbox processor) | ✅ |
| 9 | Admin RBAC + maker-checker (admin_adjustments) | ✅ |
| 10 | Wallet-to-wallet transfer (transfer_wallet_atomic RPC) | ✅ |
| 11 | Wallet-to-bank transfer (Paystack payout, reversal) | ✅ |
| 12 | Beneficiary management | ✅ |
| Mobile | Vote Contest UI (all 12 Stitch screens, Expo) | ✅ |

**Total tests: 326+ green.**

## v2 Playbook P1 + P2 Foundation (Go backend) — completed 2026-06-16

### P1 — Audit
- `docs/architecture/audit.md` — ADOPT/EXTEND/KEEP/CONFLICT map created.
- Key decision: **Keep Gin, not Chi** (CLAUDE.md requires Gin v1.10).

### P2 — Platform primitives (Go)
- `backend/internal/platform/db/` — pgx pool wrapper
- `backend/internal/platform/redis/` — Redis client + Redlock + cache helpers
- `backend/internal/platform/queue/` — asynq client/server + task type constants
- `backend/internal/platform/ws/` — WebSocket hub + client fan-out
- Dependencies added: `redis/go-redis/v9`, `jackc/pgx/v5`, `hibiken/asynq`, `nhooyr.io/websocket`, `golang-jwt/jwt/v5`

### P2 — Finance core (Go)
- `backend/internal/finance/ledger/` — Repository (pgx, immutable entries, PostJournal, GetBalance, ListEntries) + Service (Credit, Debit, GetBalance, ListTransactions)
- `backend/internal/finance/wallet/` — Service (GetBalance, Credit, Debit, ListTransactions) + Handler (GET /finance/wallet/balance, GET /finance/wallet/transactions)
- `backend/internal/finance/kyc/` — Service (GetProfile, Initiate, Approve, Fail) + Handler
- `backend/internal/finance/tiers/` — TierConfig, GetUserTier, EnforceWalletDebitLimit (fail-closed)
- `backend/internal/finance/transfers/` — WalletToWallet + BankTransfer services (advisory locks, idempotency, fee schedule)
- `backend/internal/finance/referrals/` — GetOrCreateCode, ProcessReward (at-most-once via UNIQUE constraint)

### P2 — Provider abstraction (Go)
- `backend/internal/provider/interfaces.go` — PaymentProvider, VirtualAccountProvider interfaces
- `backend/internal/provider/paystack/` — Paystack adapter (HMAC-SHA512 webhook verification, InitializePayment, VerifyPayment, InitiatePayout, ProvisionVA)

### P2 — Config + routing
- `backend/internal/config/config.go` — DATABASE_URL, REDIS_URL, PAYSTACK_SECRET_KEY, feature flags
- `backend/internal/app/finance_routes.go` — Finance routes registered under `/api/finance/` (flag-gated)

**All existing Go tests still pass. `go build ./...` clean.**

## v2 Next: P3+ Vertical lanes
After P2 gate (Security + QA sign-off):
- **Lane A**: FX module (Maplerad)
- **Lane B**: Groups (subscriptions, AI notes, chat)
- **Lane C**: Events & tickets
- **Lane D**: Estate + private voting
- **Lane E**: Crowdfunding
- **Lane F**: Restaurant + delivery → Transport
- **Lane G**: Telemedicine / pharmacy / veterinary
- **Lane H**: Spotlight integration (paid voting → wallet)

Each lane: Backend Agent → OpenAPI contract → Admin Frontend Agent + Stitch UI Agent + Mobile Module Agent (parallel) → Integration/E2E Agent.

## Critical constraints (always apply)
- All money amounts: BIGINT kobo, never float
- Idempotency-Key required on every money mutation
- Ledger entries: immutable (INSERT only, no UPDATE/DELETE)
- Balance = projection of ledger, never stored directly
- Fail-closed: tier/balance checks block on any error
- Feature-flag every module (env var)
- All new FKs → auth.users(id)
- Additive DB migrations only
- Never edit protected legacy Spotlight files
- Go router: Gin (never Chi)
- pgx for money-path DB access; Supabase REST for Spotlight modules

**Why:** Financial-grade invariants. Balance updates without ledger would be untraceable. Fail-open on tier checks would allow unauthorized spending.
