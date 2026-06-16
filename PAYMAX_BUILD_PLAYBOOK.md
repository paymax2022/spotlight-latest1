# Paymax × Spotlight — Build Playbook v2

> **This document is the authoritative source of truth for the build sequence.**  
> It supersedes `docs/build-playbook.md` (v1). v1 remains for historical reference and per-block detail.  
> Architecture audit: `docs/architecture/audit.md`.  
> API spec: `contracts/openapi.yaml`.

---

## Project overview

Spotlight is a live contest/voting platform being transformed into a **fintech super app** on top of the existing Spotlight brownfield codebase.

**Rule:** One block per branch. Each block must leave all tests green and the feature flagged off before merge. Blocks are strictly ordered where marked with a dependency.

---

## Completed blocks (feat/tiers-and-limits branch)

| Block | Name | Status |
|-------|------|--------|
| 0 | Golden-path E2E baseline | ✅ DONE |
| 1 | Platform scaffold (feature flags, env contract, OpenAPI stub) | ✅ DONE |
| 2 | KYC schema (migrations + state machine + API routes) | ✅ DONE |
| 3 | Double-entry ledger schema | ✅ DONE |
| 4 | Wallet service (balance, topup, transactions) | ✅ DONE |
| 5 | Paystack DVA provisioning + inbound transfer credit | ✅ DONE |
| 6 | Vote bridge (idempotent, KYC-gated, outbox) | ✅ DONE |
| 7 | Per-tier daily limits + atomic debit RPC | ✅ DONE |
| 8 | Referral reward (at-most-once, 50,000 kobo = ₦500) | ✅ DONE |
| 9 | Fintech admin RBAC (maker/checker, adjustments) | ✅ DONE |
| 10 | Wallet-to-Wallet transfer (atomic RPC, fee schedule) | ✅ DONE |
| 11 | Wallet-to-Bank transfer (Paystack payout, webhook lifecycle) | ✅ DONE |
| 12 | Beneficiary management (save, nickname, last_used_at) | ✅ DONE |

### Go backend modules (all in `backend/internal/`)

All 27 packages pass `go test ./...`. `go vet ./...` and `go build ./...` are clean.

| Module | Package | Status |
|--------|---------|--------|
| Double-entry ledger | `finance/ledger` | ✅ |
| Wallet service | `finance/wallet` | ✅ |
| KYC state machine | `finance/kyc` | ✅ |
| Tier limits | `finance/tiers` | ✅ |
| Outbound transfers | `finance/transfers` | ✅ |
| Settlement lifecycle | `finance/settlement` | ✅ |
| Referrals | `finance/referrals` | ✅ |
| Virtual accounts (DVA) | `finance/va` | ✅ |
| FX / Maplerad | `finance/fx` | ✅ |
| Dispute management | `finance/disputes` | ✅ |
| Ratings | `finance/ratings` | ✅ |
| Vote bridge adapter | `votebridge` | ✅ |
| Telemedicine | `telemedicine` | ✅ |
| Transport | `transport` | ✅ |
| Restaurant delivery | `restaurant` | ✅ |
| Events & ticketing | `events` | ✅ |
| Crowdfunding | `crowdfunding` | ✅ |
| Estate management | `estate` | ✅ |
| Group savings | `groups` | ✅ |
| AI Care | `aicare` | ✅ |
| Notifications (queue) | `notifications` | ✅ |
| Payment providers | `provider`, `provider/paystack`, `provider/maplerad` | ✅ |
| Webhooks | `webhooks` | ✅ |

### Admin dashboard (`frontend-admin/`)

Finance admin pages at `/admin/finance/`:
- **Hub** — overview cards for KYC, wallets, adjustments
- **KYC Queue** — list pending submissions; approve (with tier) / reject
- **Wallet Lookup** — search by user ID, view balance + transaction history

Admin routes in Go backend: `/api/finance/admin/kyc/...` and `/api/finance/admin/wallets/...`

---

## Iron rules — never violate

### Money handling
- All monetary amounts are **integers in minor units (kobo)**. Never floats. Never strings for math.
- Every money mutation MUST: (1) require an `Idempotency-Key`, (2) post balanced double-entry ledger entries, (3) emit an audit event, (4) pass tier-limit checks fail-closed.
- Wallet balances are **projections of the ledger** — never UPDATE a balance column directly.
- Ledger entries are immutable. Corrections = reversing entries only.

### Brownfield safety
- **NEVER modify files in the existing Spotlight modules** (contests, voting, applicants, legacy auth). Wrap them via adapters (see `vote-bridge` skill).
- All DB migrations are **additive-only**: no DROP, no column renames, no type narrowing.

### Workflow
- API changes start in `contracts/openapi.yaml` — spec PR first, then implementation.
- New module = run `/new-module` command.
- Feature-flag every new module. No flag, no merge.
- Conventional Commits. PRs < 400 lines where possible.

---

## Next blocks (not yet started)

### Block 13 — Telemedicine booking & settlement
**Flag:** `FEATURE_TELEMEDICINE_ENABLED`

Deliverables:
- Supabase migration: `appointments` table (patient_id, doctor_id, slot, status, settlement_id)
- Go service: `backend/internal/telemedicine/service.go` — `Book()`, `Confirm()`, `Cancel()`, `Settle()` (85% doctor / 15% platform)
- Settlement via `settlement.Service.Settle()` then `Refund()` on cancellation
- API routes: `POST /api/v1/telemedicine/appointments`, `POST /api/v1/telemedicine/appointments/:id/confirm`
- Feature flag: `FEATURE_TELEMEDICINE_ENABLED`

Acceptance criteria:
- [ ] Booking debits patient wallet (atomic, idempotent)
- [ ] Settlement: doctor receives 85%, platform 15% of `ConsultationFeeKobo`
- [ ] Cancellation refunds patient minus any penalty
- [ ] Double-booking same slot → 409
- [ ] All money mutations produce balanced ledger entries
- [ ] `go test ./internal/telemedicine/...` green

---

### Block 14 — Transport (ride-hailing) booking & settlement
**Flag:** `FEATURE_TRANSPORT_ENABLED`

Deliverables:
- Supabase migration: `rides` table (rider_id, driver_id, status, fare_kobo, settlement_id)
- Go service: `backend/internal/transport/service.go` — `RequestRide()`, `AcceptRide()`, `CompleteRide()`, `CancelRide()`
- Base fare: `150,000 kobo` (₦1,500); surge multiplier via `SurgeMultiplier float64`
- Split: `ProviderPct + PlatformPct + RiderPct = 1.0` (driver gets `RiderPct`)
- Settlement: `CompleteRide()` calls `settlement.Service.Settle()` with split
- API routes: `/api/v1/transport/rides`

Acceptance criteria:
- [ ] `ProviderPct + PlatformPct + RiderPct = 1.0` enforced at ride creation
- [ ] Concurrent `AcceptRide` on same ride → only one driver wins (Redlock)
- [ ] Fare in kobo integer — no float arithmetic
- [ ] Cancel before match → full refund; cancel after match → partial refund
- [ ] `go test ./internal/transport/...` green

---

### Block 15 — Restaurant delivery
**Flag:** `FEATURE_RESTAURANT_ENABLED`

Deliverables:
- Supabase migration: `restaurant_orders` (items JSONB, total_kobo, delivery_fee_kobo, status, settlement_id)
- Go service: `backend/internal/restaurant/service.go` — `PlaceOrder()`, `ConfirmOrder()`, `DeliverOrder()`, `CancelOrder()`
- Delivery fee: `50,000 kobo` (₦500) flat; total = sum(items) + delivery_fee
- Split: restaurant 70% / rider 20% / platform 10% of items; full delivery fee to rider
- Rating prompt on `DeliverOrder()`

Acceptance criteria:
- [ ] `TotalKobo = ItemsTotalKobo + DeliveryFeeKobo`
- [ ] Order settle: balanced ledger entries for restaurant + rider + platform splits
- [ ] Cancel before preparation: full refund; cancel during: partial
- [ ] `go test ./internal/restaurant/...` green

---

### Block 16 — Estate management
**Flag:** `FEATURE_ESTATE_ENABLED`

Deliverables:
- Go service: `backend/internal/estate/service.go` — `IssueVisitorPass()`, `ScanPass()`, `RevokePass()`, `CreateElection()`, `CastVote()`, `CloseElection()`
- Visitor QR: UUID generated at INSERT, immutable
- Election: UNIQUE(election_id, voter_id) + Redlock for at-most-once voting
- Dues payment: `PayDues()` debits wallet, credits estate account via ledger

Acceptance criteria:
- [ ] Duplicate vote → 409 (UNIQUE constraint)
- [ ] Expired pass scan → 403
- [ ] Dues payment idempotent on `IdempotencyKey`
- [ ] Election with < 2 candidates → 422
- [ ] `go test ./internal/estate/...` green

---

### Block 17 — Crowdfunding
**Flag:** `FEATURE_CROWDFUNDING_ENABLED`

- Go service: `backend/internal/crowdfunding/service.go` — `CreateCampaign()`, `Contribute()`, `FundCampaign()` (settle all contributions), `FailCampaign()` (refund all)
- `GoalKobo` minimum 100 (₦1); contributions minimum 100 kobo
- On `GoalKobo` reached: auto-settle all held contributions
- On deadline without goal: auto-refund all contributions

---

### Block 18 — Events & ticketing
**Flag:** `FEATURE_EVENTS_ENABLED`

- Go service: `backend/internal/events/service.go` — `CreateEvent()`, `PurchaseTicket()`, `ScanTicket()`, `RefundTicket()`, `CancelEvent()`
- QR code: UUID, immutable at INSERT
- Paid tickets: debit via wallet, idempotent on `IdempotencyKey`
- `CancelEvent()` → bulk refund all non-scanned tickets

---

### Block 19 — Group savings (Ajo / Esusu)
**Flag:** `FEATURE_GROUPS_ENABLED`

- Go service: `backend/internal/groups/service.go` — `CreateGroup()`, `InviteMember()`, `PayDues()`, `DistributePot()`
- Dues payment idempotent on `PlanID + IdempotencyKey`
- `DistributePot()` uses settlement.Service to credit current cycle recipient

---

### Block 20 — AI Care (async health AI)
**Flag:** `FEATURE_AICARE_ENABLED`

- Go service: `backend/internal/aicare/service.go` — `StartSession()`, `SendMessage()`, `EscalateToAgent()`, `ResolveSession()`
- Charges per consultation deducted from wallet; `SessionResolved` is terminal
- Human escalation (`SessionEscalated`) triggers notification to on-call agent

---

### Block 21 — Ratings
**Flag:** `FEATURE_RATINGS_ENABLED`

- Go service: `backend/internal/finance/ratings/service.go` — `SubmitRating()`, `GetSummary()`
- UNIQUE(entity_id, rater_id, transaction_ref) — one rating per transaction
- Score: float32, 1.0–5.0 (binding:min=1,max=5)
- Summary: `AVG(score)` + `COUNT(*)` by entity

---

### Block 22 — Disputes
**Flag:** `FEATURE_DISPUTES_ENABLED`

- Go service: `backend/internal/finance/disputes/service.go` — `Open()`, `Escalate()`, `Resolve()`, `Close()`
- `DisputeType` covers: transfer, topup, vote, order, ticket, ride, contribution
- Resolution: `refund` triggers `settlement.Service.Refund()`; `partial_refund` triggers partial reversal

---

## Feature flag registry

All flags default to `false`. Set in environment to enable.

| Flag | Module |
|------|--------|
| `FEATURE_KYC_ENABLED` | KYC state machine |
| `FEATURE_WALLET_ENABLED` | Wallet + ledger |
| `FEATURE_VIRTUAL_ACCOUNTS_ENABLED` | DVA provisioning |
| `FEATURE_TIER_LIMITS_ENABLED` | Per-tier daily limits |
| `FEATURE_REFERRALS_ENABLED` | Referral rewards |
| `VOTES_BRIDGE_ENABLED` | Vote bridge |
| `FEATURE_WALLET_TRANSFERS_ENABLED` | Wallet-to-wallet |
| `FEATURE_BANK_TRANSFERS_ENABLED` | Wallet-to-bank |
| `FEATURE_BENEFICIARIES_ENABLED` | Saved beneficiaries |
| `FEATURE_FINTECH_ADMIN_ENABLED` | Finance admin dashboard |
| `FEATURE_TELEMEDICINE_ENABLED` | Telemedicine |
| `FEATURE_TRANSPORT_ENABLED` | Transport / ride-hailing |
| `FEATURE_RESTAURANT_ENABLED` | Restaurant delivery |
| `FEATURE_EVENTS_ENABLED` | Events & ticketing |
| `FEATURE_CROWDFUNDING_ENABLED` | Crowdfunding |
| `FEATURE_ESTATE_ENABLED` | Estate management |
| `FEATURE_GROUPS_ENABLED` | Group savings |
| `FEATURE_AICARE_ENABLED` | AI Care |
| `FEATURE_RATINGS_ENABLED` | Ratings |
| `FEATURE_DISPUTES_ENABLED` | Disputes |
| `FEATURE_FX_ENABLED` | FX / currency conversion |

---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend API | Go 1.23, Gin v1.10 — NOT Chi |
| DB access (money path) | pgx pool (`backend/internal/platform/db/`) |
| DB access (Spotlight) | Supabase REST + SQL RPCs |
| Queue | Redis via asynq (`backend/internal/platform/queue/`) |
| Cache / Redlock | Redis (`backend/internal/platform/redis/`) |
| Payments | Paystack (HMAC-SHA512 webhook) |
| FX | Maplerad |
| Frontend web | Next.js 14.2, TypeScript, Supabase SSR |
| Frontend admin | Next.js 15.1, port 4030 |
| Mobile | Expo Router (React Native) |
| Auth | Supabase Auth (JWT/HS256) |
| Storage | Cloudflare R2 |
| Email | Resend |

## Key financial constants

| Constant | Value | Notes |
|----------|-------|-------|
| Referral reward | 50,000 kobo (₦500) | at-most-once via UNIQUE(referrer_id, referred_id) |
| Transport base fare | 150,000 kobo (₦1,500) | before surge multiplier |
| Restaurant delivery fee | 50,000 kobo (₦500) | flat fee |
| Telemedicine split | 85% doctor / 15% platform | settled via settlement.Service |
| Wallet transfer fee bands | ₦0–₦5k: free; ₦5k–₦50k: ₦10; >₦50k: ₦25 | |
| Bank transfer fee bands | ₦0–₦5k: ₦10; ₦5k–₦50k: ₦25; >₦50k: ₦50 | min transfer ₦1,000 |
| Admin adjustment auto-execute | < 100,000,000 kobo (₦1,000,000) | ≥ this requires checker |
