# Crypto Module — Current State Audit (Phase 0 Discovery)

**Date:** 2026-10-27  
**Status:** In Progress — Evidence-based audit, no assumptions  
**Execution:** Following `Crypto_Quidax_Brownfield_Implementation_Workplan.md` Phase 0

---

## 1. Repository Structure & Baseline

### Backend (Go 1.27)
- **Module:** `spotlight/backend`
- **Crypto package:** `backend/internal/crypto/`
- **Router:** Gin v1.10
- **DB:** PostgreSQL 17 via Supabase, pgx pool
- **Queue:** Redis (asynq)

### Frontend Web (Next.js 14.2)
- **Crypto feature:** `frontend-web/src/features/crypto/` (if exists)
- **Mobile:** React Native/Expo at `mobile-app/reactnative/`

### Admin (Next.js 15.1)
- **Crypto admin:** `frontend-admin/` (port 3001)

### Database
- **Migrations:** `supabase/migrations/`
- **Crypto migrations found:**
  - `20271027000000_crypto_webhook_events_and_swaps.sql`
  - `20271028000000_ledger_crypto_clearing_account_type.sql`
  - `20271028000100_crypto_swaps_ledger_inputs.sql`
  - `20271031000000_crypto_accounts_and_swap_idempotency.sql`
  - `20271038000000_crypto_fee_schedules.sql`
  - `20271042000000_crypto_member_permissions.sql`
  - `20271065000008_restaurant_kyb_versioning_withdraw.sql`
  - `20271071000000_crypto_deposits.sql`
  - `20271099000050_crypto_watchlist_and_price_alerts.sql`

---

## 2. Backend Crypto Module Inventory

### Core Files Discovered
```
backend/internal/crypto/
├── handler.go                          (API routes and request/response handlers)
├── handler_ext.go                      (Extended handlers)
├── service.go                          (Business logic; quote, trade, settlement)
├── service_ext.go                      (Extended service methods)
├── repository.go                       (Data access layer)
├── repository_ext.go                   (Extended repository methods)
├── model.go                            (Domain models: Order, Quote, Asset, etc.)
├── provider.go                         (Provider interface: PriceProvider, WithdrawalProvider)
├── onchain.go                          (On-chain/blockchain interaction logic)
├── deposit/
│   ├── deposit.go                      (Deposit service)
│   ├── pgxstore.go                     (Deposit persistence)
│   ├── dbresolver.go                   (DB resolution for deposits)
│   ├── policy.go                       (Deposit policy/validation)
│   ├── settler.go                      (Deposit settlement/finalization)
│   └── deposit_test.go                 (Tests)
├── admin_service.go                    (Admin-scoped operations)
├── admin_repository.go                 (Admin data access)
├── store.go                            (Main store interface)
├── dbresolver.go                       (DB resolver for main crypto module)
└── [Multiple test files]
    ├── invariants_test.go              (Ledger invariant tests)
    ├── live_journey_test.go            (End-to-end journey tests)
    ├── tier_gate_test.go               (Tier/eligibility gate tests)
    ├── swap_atomicity_live_db_test.go  (Atomicity and concurrency tests)
    ├── member_permissions_live_db_test.go (Permission tests)
    ├── deposits_live_db_test.go        (Deposit flow tests)
    ├── provider_quidax_test.go         (Quidax provider tests)
    └── ...
```

### Handler Routes (Initial Scan)
From `handler.go`:
- `GET /assets` — List active assets
- `GET /assets/:id/quote` — Get asset price quote
- `GET /assets/:id/quote-history` — Price history (chart data)
- `GET /transactions/:id` — Get owned transaction detail

(Extended routes in `handler_ext.go` to be examined)

### Service Methods (Initial Scan)
From `service.go`:
- `ListAssets(ctx, activeOnly bool)` — Return supported assets
- `Quote(ctx, symbol string)` — Current price quote
- `PriceHistory(ctx, symbol, limit)` — Historical prices
- `GetOrder(ctx, userID, orderID)` — Owned transaction
- (Extended methods in `service_ext.go` to be examined)

### Model Types (Initial Scan)
From `model.go`:
- `Order` — Transaction record
- `Quote` — Price snapshot
- `Asset` — Supported coin/pair definition
- (Additional types to be catalogued)

### Provider Interfaces
From `provider.go`:
- **`PriceProvider`** interface:
  - `PriceKobo(ctx, symbol)` — Get NGN kobo price per whole unit
  - `Name()` — Provider identifier
  - **Implementation found:** `MockPriceProvider` (deterministic seeds, no network)

- **`WithdrawalProvider`** interface:
  - `Broadcast(ctx, BroadcastRequest)` — Submit withdrawal (idempotent)
  - `Name()` — Provider identifier
  - **Implementation found:** Mock (no real on-chain broadcast yet)

---

## 3. Quidax Integration Status

### Expected (Workplan R1 scope)
- ✅ Instant Swap quote endpoint: `POST /exchange-open-api/api/v1/users/{user_id}/swap_quotation`
- ✅ Confirm swap endpoint: `POST .../swap_quotation/{quotation_id}/confirm`
- ✅ Retrieve swap transaction: `GET .../swap_transactions/{swap_transaction_id}`
- ✅ Webhooks: Event signature verification and processing
- ⚠️ Provider adapter implementation (currently mocked)
- ⚠️ Quidax subaccount management (if applicable)
- ⚠️ Deposit/withdrawal (conditional on product approval)

### Code Scan Results
- **`provider_quidax_test.go`** found → Quidax contract tests exist; **needs review for current fixture/mock vs live**
- No direct `quidax_client.go` or `quidax_adapter.go` file found yet (may be embedded in provider.go or service_ext.go)
- Provider interface supports pluggable adapters; **mock is current default**

### Custody & Ledger Model
- **`crypto_accounts_and_swap_idempotency`** migration indicates:
  - Account-level idempotency tracking
  - Possible Quidax per-user subaccount mapping
  - **To verify:** 1:1 user:subaccount or pooled model
- **`ledger_crypto_clearing_account_type`** migration indicates:
  - Double-entry ledger already extended for crypto
  - Clearing accounts for FX/conversion
  - **To verify:** Ledger schema alignment with Workplan 6.3

### Webhook Handling
- **`crypto_webhook_events_and_swaps`** migration indicates:
  - Webhook event storage (table structure to be examined)
  - Swap transaction linking
  - **To verify:** Signature verification, replay protection, DLQ implementation

---

## 4. Database Schema (Partial Catalog)

### Confirmed Entities (from migrations)
- `crypto_accounts` — User account mapping and Quidax subaccount links
- `crypto_quotes` — Quote history and TTL tracking
- `crypto_trades` / `crypto_swaps` — Transaction records with provider references
- `crypto_webhook_events` — Incoming webhook event log
- `crypto_deposits` — (conditional) Deposit tracking
- `crypto_fees` — Fee schedule configuration
- `crypto_member_permissions` — Access control

### Ledger Integration
- `ledger_journals` / `ledger_postings` — Main ledger (existing, extended for crypto)
- `wallet_holds` — Reservation locks during trade

---

## 5. Mobile App Status

### Crypto Feature Location
- **Expected:** `mobile-app/reactnative/src/features/crypto/`
- **Found:** `mobile-app/reactnative/src/features/crypto/api/crypto.api.ts` (API client)
- **Status:** Mobile screens (React Native/Expo Router) — **to be inventoried**
- **Navigation:** Expo Router integration expected

### Routes (to be catalogued)
- Crypto entry / home
- Asset list / detail
- BUY / SELL / SWAP forms
- Quote review & confirmation
- Transaction history / receipt
- (Conditional: deposit, withdrawal)

---

## 6. Admin Web Status

### Crypto Admin Location
- **Expected:** `frontend-admin/app/admin/crypto/` (Next.js structure)
- **Status:** Crypto admin features — **to be inventoried**
- **Dashboard:** Transaction monitoring, reconciliation, reports — **to verify**

### Features (to be catalogued)
- Transaction search / filter
- Trade investigation (quote→confirm→webhook→ledger timeline)
- Reconciliation dashboard
- Fee/limit configuration
- Risk & compliance review
- Export center (CSV/reports)

---

## 7. CI/CD & Test Baseline

### Detected Test Coverage
- **Unit tests:** invariants, tier gates, permissions, deposits
- **Live DB tests:** Actual Postgres tests (integration scope)
- **Journey tests:** End-to-end trade flows
- **Atomicity tests:** Race conditions, concurrency
- **Quidax contract tests:** Provider fixture/mock validation

### Build & Lint Status
- Backend: `go build ./...`, `go vet ./...`, `go test ./...`
- (To run baseline before modifications)

---

## 8. Known Gaps & Open Questions

| Gap | Impact | Owner | Status |
|-----|--------|-------|--------|
| Quidax live adapter vs mock | R1 execution unknown | Backend | Not Assessed |
| Custody model (per-user vs pooled) | Architecture decision | TL + Finance | Not Assessed |
| Deposit/withdrawal approval | Feature gate, compliance | Product + Legal | Not Assessed |
| Mobile UI completion | R1 delivery | Mobile | Not Assessed |
| Admin reporting SQL/views | Finance operability | Admin + Finance | Not Assessed |
| Webhook signature validation (Quidax-specific) | Security critical | Backend + Security | Not Assessed |
| Quote TTL enforcement (15 sec) | User experience | Backend | Not Assessed |
| Feature flags in code | Rollout control | Backend | Not Assessed |

---

## 9. Recommended Next Steps (CR-001 → CR-007)

1. **CR-002:** Read/scan `handler_ext.go`, `service_ext.go`, `repository_ext.go` for missing routes and business logic
2. **CR-003:** Inventory mobile routes/screens; mark Existing / Partial / Broken / Missing
3. **CR-004:** Inventory admin pages, RBAC, reports
4. **CR-005:** Verify custody topology in migrations and code; document ledger/fiat source of truth
5. **CR-006:** Confirm Quidax merchant account details, API keys (secure), test fixtures
6. **CR-007:** Obtain Product/Legal approval for R1 scope and feature flags

---

## Exit Gate G0 Requirements
- [ ] Audit complete: no unreviewed code paths
- [ ] Gap register populated with impact/priority/disposition
- [ ] Custody and ledger ownership documented and signed
- [ ] Quidax merchant credentials secured and validated
- [ ] R1 scope and conditional features approved
- [ ] Feature flag list defined in code

**Next:** Detailed code review (CR-002–CR-007) and gap register generation.
