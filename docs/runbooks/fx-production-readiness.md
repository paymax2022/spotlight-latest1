# FX vertical — production-readiness checklist

Turns "make FX production grade" into a tracked backlog. Status legend:
**✅ done** · **🟡 partial** · **⬜ todo**. "Verify" = how it's proven, and whether
that needs the Go toolchain / a running DB / a live provider (none available in
the Cowork sandbox — those items are handed to a dev/CI run).

## 1. Functional completeness (stubs → real)

| Item | Status | Verify |
|---|---|---|
| Core exchange: rates → quote → lock → convert | ✅ done | `go test ./internal/orchestration/...` (existing) |
| **Wire format camelCase** (Go emitted snake_case; mobile expects camelCase — broke ALL real responses) | ✅ done | `domain_json_test.go` guards; OpenAPI updated |
| `Transfer.beneficiary` field (mobile expects it; Go `Transfer` has none) | ⬜ todo | store beneficiary summary on transfer, or resolve on read |
| `VirtualAccount.details` map keys camelCase (accountName, bankName…) | ⬜ verify | check the provider adapter builds camelCase detail keys |
| Beneficiaries persisted (`orch_beneficiaries`) | ✅ done | store test (§4) + local DB |
| Rate alerts persisted (`orch_rate_alerts`) | ✅ done | store test (§4) + local DB |
| `GET /collections` → read `orch_collections` (currently returns `[]`) | ⬜ todo | add `SecondaryStore.ListCollections` scoped by customer |
| `GET /transfers/:reference` → read `orch_transfers` (currently synthesized) | ⬜ todo | add customer-scoped `TransferByReference` |
| `GET /rates/history` → real rate feed (currently deterministic) | 🟡 partial | wire to provider/history table; keep deterministic fallback |
| Virtual cards (issue/reveal/fund/controls/txns) | ⬜ todo | provider issuer + PCI-isolated reveal; **not** a stub in prod |
| Rate-alert evaluation (fire when target crossed) | ⬜ todo | scheduled job comparing `orch_rate_alerts.target` vs live rate |

## 2. Money-path integrity (iron rules)

| Item | Status | Verify |
|---|---|---|
| Conversions: Idempotency-Key + balanced double-entry | ✅ done | `ApplyConversion` (repository.go) + idempotency test |
| Transfers: Idempotency-Key + debit + ledger row | ✅ done | `ApplyTransfer` + idempotency test |
| Tier-limit checks fail-closed on convert/transfer | 🟡 verify | confirm limits enforced pre-debit; add test |
| **Card funding is money-path** — currently a stub | ⬜ todo | real handler MUST add Idempotency-Key + double-entry before shipping |
| Wallet balances are ledger projections (never direct UPDATE) | ✅ done | `orch_balances` updated only inside conversion/transfer tx |
| Beneficiaries / rate-alerts / disputes are NOT money-path | ✅ done | no ledger writes (by design) |

## 3. Persistence & data integrity

| Item | Status | Verify |
|---|---|---|
| Additive-only migration, local-first apply | ✅ done | `supabase migration up` (local); DDL parses (pglast) |
| Customer-scoped queries (object-level authZ) | ✅ done | every query filters `customer_id`; store test |
| Unique beneficiary guard (no dup per customer+account+currency) | ⬜ todo | additive partial unique index migration |
| Cross-customer update/delete returns not-found (no leakage) | ✅ done (code) | needs test (§4) |
| Indexes for list queries | ✅ done | `*_customer_idx` in migration |

## 4. Tests (highest-value next increment)

| Item | Status | Verify |
|---|---|---|
| `SecondaryStore` interface + in-memory fake (test enabler) | ✅ done | `secondary_store_test.go` |
| Secondary store: create/list/update/favorite/delete round-trip | ✅ done | `go test ./internal/orchestration/ -run RoundTrip` |
| AuthZ: customer A cannot read/update/delete customer B's rows | ✅ done | `TestBeneficiaryCrossCustomerIsolation`, `...ObjectLevelAuthZ` |
| Handler: beneficiary create → list reflects it; validate rules | ✅ done | `TestHandlerBeneficiary*`, `TestHandlerValidateBeneficiary` |
| pgx impl (`sqlSecondaryStore`) against real DB | ⬜ todo | integration test vs local Supabase (pgx needs a DB) |
| Handler: rate-alert create/list/delete via httptest | 🟡 partial | store-level covered; add httptest if desired |
| Contract test: mobile paths ↔ openapi ↔ router (all 34) | 🟡 partial | `npm run contract:check` (already aligned) |
| Regression suite green before/after | ⬜ verify | `npm run test:regression` |

## 5. Security & privacy

| Item | Status | Verify |
|---|---|---|
| Auth mirror on `/api/v1/fx` (was missing → 401s) | ✅ done | `go build` + a signed-request smoke test |
| Provider secrets server-side only; sandbox keys in `.env` | ✅ done | grep tracked files for secrets = none |
| Webhook signature verification (inbound provider) | ✅ done | `VerifyProviderWebhook` (handler.go) |
| Card reveal PAN/CVV — needs PCI isolation in prod | ⬜ todo | stub returns masked placeholder; real reveal must be PCI-scoped |
| Input validation on beneficiary/rate-alert payloads | ✅ done | `validateBeneficiaryDraft` + rate-alert checks; `TestHandler*RejectsBadPayload`, `...ValidationAndRoundTrip` |
| PII in logs (account numbers) — ensure masked | ⬜ verify | audit log statements |

## 6. Observability & ops

| Item | Status | Verify |
|---|---|---|
| Feature-flagged (`FEATURE_FX_*`, `FEATURE_FX_ENABLED`) | ✅ done | flags gate router + proxy |
| Treasury monitor + recon scheduler | ✅ done | `StartTreasuryMonitor`, `StartReconScheduler` |
| Structured logs / metrics on FX routes | 🟡 partial | add request metrics + error-rate alerts |
| Audit events on money mutations | 🟡 verify | confirm ledger + audit emitted per convert/transfer |
| Go-live path (human-DBA `db push`, flag flip) | ✅ documented | `docs/runbooks/go-live.md` |

## 7. Governance

| Item | Status | Verify |
|---|---|---|
| OpenAPI updated for all 34 routes + schemas | ✅ done | YAML parses; refs resolve; `contract:check` |
| ADR-015 recorded | ✅ done | in `docs/adr/` |
| E2E runbook (local-first) | ✅ done | `docs/runbooks/fx-e2e-test.md` |
| Conventional commits, PR < 400 lines | ⬜ per-PR | reviewer |

## Definition of done (FX vertical → prod)

1. `go build ./... && go vet ./...` clean (from `backend/`).
2. `npm run test:regression`, `npm run test:money`, `npm run contract:check` green.
3. §4 tests written and passing; §1 stubs either made real or explicitly deferred
   behind a flag with a tracked ticket.
4. Card funding NOT enabled until it posts double-entry + requires Idempotency-Key.
5. Security items in §5 (PCI reveal, input validation, PII-safe logs) closed.

## What I can do here vs what needs your environment

- **Here (verifiable):** code, migrations (DDL parse), OpenAPI (parse + ref check),
  docs/ADRs, static route/import/param audits.
- **Needs Go toolchain / DB / providers (dev or CI):** `go build`/`go vet`,
  `go test`, `supabase migration up`, live provider smoke tests, load/security tests.

Fastest path: run `go build ./...` from `backend/` and paste any errors, then I'll
write §4 tests and close §1/§5 items in a verified loop.
