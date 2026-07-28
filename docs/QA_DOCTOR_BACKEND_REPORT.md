# QA Report — `backend/internal/doctor` (provider telemedicine) money path

**Scope:** MVP doctor module — payout money path + static iron-rule review.
**Author:** QA/Go engineer (automated review).
**Date:** 2026-06-21.
**Module path:** `spotlight/backend` · package `spotlight/backend/internal/doctor`.
**Toolchain caveat:** No Go toolchain is available in this sandbox. Tests were
authored to compile and run in CI; verification below is a **static attestation**
(symbol-by-symbol, with `file:line` evidence). See "To run in CI".

---

## 1. Test deliverables

| File | Package | Kind | Runs by default? |
|------|---------|------|------------------|
| `backend/internal/doctor/service_test.go` | `doctor` | Unit — guard clauses, sentinels, kobo/no-balance contracts | Yes |
| `backend/internal/doctor/handler_test.go` | `doctor_test` | HTTP boundary — auth guard, JSON binding, status mapping | Yes |
| `backend/internal/doctor/service_integration_test.go` | `doctor_test` | Integration — deep money path (real DB) | Only with `-tags doctor_integration` + `DOCTOR_TEST_DATABASE_URL` |

### Why the split (testability finding — IMPORTANT)

`doctor.Service` holds **concrete** dependencies, not interfaces:

```
service.go:25-30   repo *Repository ; ledger *ledger.Service ; tiers *tiers.Service ; redis *goredis.Client
```

`Repository` wraps `*pgxpool.Pool` (`repository.go:16-21`), `ledger.Service` wraps
`*ledger.Repository` (`finance/ledger/service.go:12-19`), `tiers.Service` wraps
`*pgxpool.Pool` (`finance/tiers/service.go`). **There is no interface seam**, so the
full payout path (ledger `Debit` → repo `InsertPayout` → `InsertAudit`) cannot be
exercised with in-memory fakes without a real Postgres.

Per the QA brief, the implementation was **not refactored**. This mirrors exactly
how the canonical sibling modules test:

- `finance/ledger/service_test.go` and `telemedicine/block13_test.go` test
  **sentinels / invariants / arithmetic with no DB**;
- `telemedicine/health_premium_test.go` tests the **HTTP boundary via httptest**
  with a nil service (binding/auth fire before the service call);
- neither mocks the DB.

The deep money-path cases that genuinely need the DB are therefore covered by a
**build-tagged integration suite** (skips cleanly when the DB env var is unset).

### Cases covered

| # | Iron-rule case | Where covered | Mechanism |
|---|----------------|---------------|-----------|
| 1 | Success posts balanced debit of exactly `amountKobo`; writes `doctor_payouts` row (status, idempotency_key, **no balance**); audit emitted | `service_integration_test.go::TestPayoutSuccess_PostsBalancedDebitAndPersistsRow` + `service_test.go::TestPayoutStructHasNoBalanceColumn` | DB: asserts `before-after == payout`; unit: asserts struct has `LedgerRef`/`IdempotencyKey`, no balance field |
| 2 | Idempotency replay returns prior result, **no second ledger entry** | `service_integration_test.go::TestPayoutIdempotencyReplay_NoSecondLedgerEntry` | DB: same key → `ErrDuplicateRequest` + prior `PayoutID`; balance unchanged on replay |
| 3 | Tier-limit denied → rejected fail-closed, **no ledger entry**; tier-check error also rejects | `service_integration_test.go::TestPayoutTierDenied_FailClosed_NoLedgerEntry` | DB: (a) no `user_profiles` row → `GetUserTier` errors → fail-closed; (b) `kyc_tier=0` → `ErrWalletDisabled`; balance unchanged in both |
| 4 | Insufficient funds → clean rejection mapped to right error | `service_integration_test.go::TestPayoutInsufficientFunds_Rejected` + `service_test.go::TestInsufficientFundsMapsToLedgerSentinel` | DB: returns `ledger.ErrInsufficientFunds`; unit: documents the unwrapped-passthrough contract the 422 mapping relies on |
| 5 | Missing Idempotency-Key → `ErrIdempotencyRequired` | `service_test.go::TestRequestPayout_MissingIdempotencyKey` (+ ordering, + other mutations) | Unit, no DB — guard returns before any dep is touched |
| 6 | Earnings projected from ledger (`GetBalance`), not a stored column | `service_integration_test.go::TestEarningsProjectedFromLedger` | DB: asserts `earnings.AvailableKobo == ledger.GetBalance` |
| — | Read scoping / write happy-path | repo-level (DB) | Repo scopes every query `WHERE user_id = $1` (see §4); covered structurally — see Risks |
| — | Amount validation (`amount<=0` → `ErrInvalidAmount`) | `service_test.go::TestRequestPayout_InvalidAmount` | Unit, table-driven |
| — | HTTP: auth guard (401), bad body (400), idem header read, result shape | `handler_test.go` (6 tests) | httptest, nil service |

All amounts in tests are `int64` kobo. Unit + handler tests are fully deterministic
(no network/DB). Integration tests skip without `DOCTOR_TEST_DATABASE_URL`.

---

## 2. Iron-rule compliance matrix — payout path

Evidence is `file:line` in `service.go` / `repository.go` (verified by reading the
source, not by running).

| # | Requirement | Verdict | Evidence |
|---|-------------|---------|----------|
| 1 | Require **+ dedupe** Idempotency-Key | **PASS** | Require: `service.go:166-168` (`if idemKey == "" return ErrIdempotencyRequired`). Dedupe (DB): `service.go:175-179` `FindPayoutByIdem` replay → returns prior result + `ErrDuplicateRequest`. Dedupe (lock): `service.go:183-188` Redis `AcquireLock`. Durable guarantee: `doctor_payouts.idempotency_key text NOT NULL UNIQUE` (migration `:1043`). |
| 2 | Tier-limit check, **fail-closed** | **PASS** | `service.go:191-193` `s.tiers.EnforceWalletDebitLimit(...)`; any error wrapped + returned (rejects). `tiers/service.go:48-72` fails closed on missing profile / DB error / Tier0. Runs **before** `ledger.Debit`. |
| 3 | Post balanced double-entry ledger | **PASS** | `service.go:199-205` resolves settlement standing account then `s.ledger.Debit(...)`; `ledger.Debit` posts a single balanced journal (debit user wallet / credit settlement) atomically — `finance/ledger/service.go:73-107` `PostJournal(JournalEntry{...})`. Kobo `int64`, positive-amount enforced (`:75`), funds checked (`:93-95`). |
| 4 | Persist payout row referencing ledger, **no balance column** | **PASS** | `service.go:208-211` `repo.InsertPayout(...)`. `repository.go:771-787` inserts `(id,user_id,ref,amount_kobo,currency,status,bank_account_id,ledger_ref,requested_at,idempotency_key)` — **no balance column** written or present (table `doctor_payouts`, migration `:1027-1045`, has no balance column). `ledger_ref = "doctor:payout:"+idemKey` ties row to the posting. |
| 5 | Emit audit | **PASS** | `service.go:214-218` `repo.InsertAudit(... "payout.requested" ...)`. `repository.go:788-794` inserts into `doctor_compliance_audit` (append-only — no UPDATE/DELETE anywhere in repo). |
| 6 | Return result | **PASS** | `service.go:221` returns `&RequestPayoutResult{PayoutID, Ref, Status}` (matches OpenAPI `RequestPayoutResult`). |

**Overall payout verdict: 6/6 PASS.**

**Minor observation (not a FAIL):** the audit insert error is intentionally
swallowed — `service.go:214` `_ = s.repo.InsertAudit(...)`. The audit is therefore
best-effort: a money mutation succeeds even if the audit row fails to write. The
iron rule says "emit an audit event"; it is emitted, but not transactionally
guaranteed. Flagged as a hardening item, not a blocker (the ledger posting itself
is the durable financial record).

---

## 3. Additive-scope check

- **Backend code changes = exactly the two wiring edits** plus the new package:
  - `git status` shows **`M`** on only `backend/internal/app/finance_routes.go`
    and `backend/internal/config/config.go`; everything else under
    `backend/internal/doctor/` is **`??`** (new). No existing module file modified.
  - No Spotlight legacy module (contests/voting/applicants/auth) touched.
- **Migration is additive-only.** `supabase/migrations/20260625000000_doctor_module.sql`:
  - `grep -niE "drop (table|column|constraint|index)|alter column .* type|rename"` →
    **no matches** (only the file's own header comment asserting the policy).
  - The only `DROP` statements are `DROP POLICY IF EXISTS` inside `DO` blocks
    (`:1310`, `:1320`) — the standard idempotent RLS re-create pattern, **not** a
    table/column drop. Additive-safe.
  - All tables use `CREATE TABLE IF NOT EXISTS`.
- **Feature-flagged:** `FeatureDoctorEnabled` (`config.go:66`, default `false` via
  `getEnvBool("FEATURE_DOCTOR_ENABLED", false)` `:146`); routes only mount when the
  flag is on (`finance_routes.go:659`). Complies with "no flag, no merge."

---

## 4. Route / auth check

- Mounted at **`/api/v1/doctor`** with **`RequireAuthContext`**:
  `finance_routes.go:663-664` `docGroup := r.Group("/api/v1/doctor"); docGroup.Use(middleware.RequireAuthContext(supabase, rbac))`.
- Every handler resolves the caller via `middleware.GetAuthenticatedUser`
  (`handler.go:21-27`) and aborts **401** if absent — proven by
  `handler_test.go::TestRequestPayout_NoAuth` / `TestReads_NoAuth`.
- **Reads are scoped to the authed user_id.** The handler passes `uid` into every
  service read; the repository scopes every query `WHERE user_id = $1` (e.g.
  `ListAppointments` `repository.go:146`, `GetAppointment`, `GetProfile`
  `repository.go:38` etc.) — defence-in-depth on top of RLS. The integration suite
  asserts earnings/ledger scoping by `userID`.
- **Mutations require Idempotency-Key where the table has the UNIQUE column:**
  - `doctor_payouts.idempotency_key NOT NULL UNIQUE` → `RequestPayout` requires it
    (`service.go:166`).
  - `doctor_clinical_notes.idempotency_key UNIQUE` → `SaveNote` requires it
    (`service.go:135-137`).
  - `CreatePrescription` / `CreateLabOrder` / `ReviewLabResult` likewise require it
    (`service.go:142-162`). Verified by `service_test.go::TestMutations_RequireIdempotencyKey`.
  - Reads from header in handler (`handler.go:46-48` `c.GetHeader("Idempotency-Key")`),
    matching the OpenAPI `IdempotencyKey` header parameter (`doctor.openapi.yaml:57-62`).

---

## 5. OpenAPI vs implementation (spot-check, 10 paths)

Source: `contracts/doctor.openapi.yaml`. Wired routes: `finance_routes.go:667-694`.

| OpenAPI path / method | Implemented? | Handler |
|-----------------------|--------------|---------|
| `POST /doctor/payouts` (tag `doctor-mvp`, `IdempotencyKey` param, 201/400/403/409/422) | ✅ | `RequestPayout` (`finance_routes.go:694`) — status codes match `handler.go:391-412` (`fail`: 409 dup, 422 insufficient, 400 validation) |
| `GET /doctor/earnings` | ✅ | `GetEarnings` (`:678`) |
| `GET /doctor/profile` | ✅ | `GetProfile` (`:667`) |
| `GET /doctor/verification` / `POST /doctor/verification` | ✅ | `GetVerification` (`:668`) / `SubmitVerification` (`:683`) |
| `GET /doctor/availability` / `PUT /doctor/availability` | ✅ | `GetAvailability` (`:669`) / `UpdateAvailability` (`:684`) |
| `GET /doctor/appointments` | ✅ | `ListAppointments` (`:670`) |
| `POST /doctor/appointments/{appointmentId}/status` | ✅ | `UpdateAppointmentStatus` (`:685`) |
| `POST /doctor/appointments/{appointmentId}/notes` | ✅ | `SaveNote` (`:686`) |
| `POST /doctor/prescriptions` / `GET /doctor/prescriptions` | ✅ | `CreatePrescription` (`:687`) / `ListPrescriptions` (`:674`) |
| `POST /doctor/lab-results/{resultId}/review` | ✅ | `ReviewLabResult` (`:689`) |

**Schemas verified:** `RequestPayoutRequest{required:[amountKobo]}` ↔ Go
`RequestPayoutRequest{AmountKobo int64 binding:"required"}`; `RequestPayoutResult
{payoutId, ref, status enum[pending,paid,processing]}` ↔ Go `RequestPayoutResult`.
The MVP slice matches the spec. (The `GET /doctor/payouts` *list* variant in the
spec — tag `doctor-batch6` — is **not** wired; only the MVP `POST` is. Consistent
with the scaffold inventory.)

---

## 6. Field / column cross-check (struct vs migration)

| Table | Struct | Verdict |
|-------|--------|---------|
| `doctor_payouts` (migration `:1027-1045`) | `Payout` (`model.go`) | **OK.** Struct scans the 12 SELECTed columns (`repository.go:756-758`) — `id, user_id, ref, amount_kobo, currency, status, bank_account_id, ledger_ref, requested_at, paid_at, idempotency_key, created_at`. Table has extra columns (`consult_count, period_label, provider_reference, failure_reason, updated_at`) the MVP simply does not read — **not a mismatch** (additive). **No balance column** in either. ✅ |
| `doctor_compliance_audit` (`:1170-1181`) | `InsertAudit` cols | **OK.** Inserts `user_id, action, entity_type, entity_id, detail, idempotency_key` — all present. Append-only. ✅ |
| `doctor_appointments` (`:222-241`) | `Appointment` | **OK.** Struct fields map to `id, user_id, ref, patient_id, patient, consult_type, status, slot_date, slot_time, fee_kobo, reason, is_hmo, hmo_provider, started_at, ended_at, created_at, updated_at`. `fee_kobo bigint` ↔ `int64`. ✅ |
| `doctor_clinical_notes` (`:338-358`) | `ClinicalNote` + `SaveNote` | **OK.** `idempotency_key UNIQUE` present → service enforces key. Fields align. ✅ |

No type-narrowing or float/string money columns found. `amount_kobo` and
`fee_kobo` are `bigint` ↔ Go `int64` throughout.

---

## 7. Risks / gaps

1. **No interface seam → no pure-unit coverage of the deep money path.** The
   success/replay/tier/insufficient/earnings assertions live in the build-tagged
   integration suite and need a real Postgres with the doctor + ledger + tiers
   schema. **Minimal seam to enable hermetic unit tests** (recommended, not done
   here per brief): define in the `doctor` package
   ```go
   type ledgerPort interface {
       GetBalance(ctx, userID) (int64, error)
       GetOrCreateStandingAccount(ctx, AccountType) (*ledger.Account, error)
       Debit(ctx, userID, ref, idem, creditAcc string, amountKobo int64) error
   }
   type tierPort interface { EnforceWalletDebitLimit(ctx, userID, amountKobo) error }
   type payoutStore interface { FindPayoutByIdem(...); InsertPayout(...); InsertAudit(...) }
   ```
   and have `Service` hold those interfaces (the concrete `*ledger.Service` /
   `*tiers.Service` / `*Repository` already satisfy them). Then cases 1–4 & 6 run
   in-memory. This is a one-struct change with zero behavior change.
2. **MVP is ~28 wired endpoints of ~283 scaffolded.** `routes_remaining.go`
   documents the full inventory (`doctor-mvp` done; `doctor-profile`,
   `-onboarding`, `-phase2/3`, `-batch1..7`, `vet` = TODO). Only the MVP slice is
   tested/active. The OpenAPI declares 276 `/doctor/*` path entries; the rest are
   stubs.
3. **No Go toolchain in this environment.** Tests are statically verified
   (imports, symbols, signatures cross-checked against source `file:line`) but were
   **not executed here**. CI must run them — see §8.
4. **Audit write is best-effort** (error swallowed, `service.go:214`). Consider
   posting the audit inside the same path the ledger uses, or at least logging the
   failure, so iron-rule (5) is durable rather than fire-and-forget.
5. **Tier happy-path depends on a `user_profiles` row.** `EnforceWalletDebitLimit`
   fails closed when no profile exists, so the integration success/replay tests
   must `seedTier(...)` first (they do). This is correct fail-closed behavior, but
   worth noting operationally: a doctor with no `user_profiles` row can never be
   paid out — confirm onboarding always creates the profile.
6. **No field/column mismatches found** in the four tables checked. The only
   "extra columns not read" cases are additive and harmless.

---

## 8. To run in CI

```bash
cd backend
go test ./internal/doctor/...                 # unit + handler (hermetic, no DB)
go vet ./internal/doctor/...
go build ./...

# Deep money path (requires a DB with the doctor + ledger + tiers schema):
DOCTOR_TEST_DATABASE_URL=postgres://user:pass@localhost:54322/postgres \
  go test -tags doctor_integration ./internal/doctor/...
```

Run `go mod tidy` if `github.com/google/uuid` needs promoting from `// indirect`
(it is already a transitive dep used by `repository.go`; the integration test uses
`uuid.NewString()`).

---

## 9. Static verification attestation (no toolchain)

Checked by reading source, not executing:

- **Imports resolve:** `service_test.go` imports only stdlib (`context`, `errors`,
  `testing`) + in-package symbols. `handler_test.go` imports `gin`,
  `spotlight/backend/internal/doctor`, `.../domain`, `.../middleware` — all exist
  (`middleware.AuthUserContextKey` `auth_context.go:12`,
  `middleware.GetAuthenticatedUser` `:47`, `domain.AuthenticatedUser{ID}`
  `auth_rbac.go:5`). `service_integration_test.go` imports `google/uuid`,
  `.../doctor`, `.../finance/ledger`, `.../finance/tiers`, `.../platform/db`.
- **Referenced `doctor.*` symbols exist:** `NewService` (`service.go:34`),
  `NewHandler` (`handler.go:17`), `RequestPayout` (`service.go:164`),
  `RequestPayoutRequest`/`RequestPayoutResult`/`Earnings`/`Payout` (`model.go`),
  `ErrIdempotencyRequired`/`ErrInvalidAmount`/`ErrDuplicateRequest`
  (`service.go:39-43`), `ErrNotFound` (`repository.go:26`), all handler methods.
- **Dependency constructors match:** `ledger.NewService(*Repository, *redis)`
  (`ledger/service.go:17`), `ledger.NewRepository(*pgxpool.Pool)`
  (`ledger/repository.go:17`), `tiers.NewService(*pgxpool.Pool)`
  (`tiers/service.go:16`), `db.New(ctx, dsn)` (`platform/db/db.go:15`), `db.Pool`
  alias (`:11`). `ledger.AccountSettlement` (`ledger/model.go:28`),
  `ledger.ErrInsufficientFunds` (`ledger/service.go:118`).
- **Guard-clause safety with nil deps:** `RequestPayout` checks `idemKey==""`
  (`service.go:166`) and `amount<=0` (`service.go:170`) **before** dereferencing
  `s.repo/s.ledger/s.tiers`, so `newServiceNoDeps()` cannot panic in the unit
  tests. Same for `SaveNote`/`CreatePrescription`/`CreateLabOrder`/`ReviewLabResult`
  (idem check first).
- **Handler nil-service safety:** auth/binding failures return before `h.svc.*` is
  called (`handler.go` each method: `userID` then `ShouldBindJSON` then service),
  so `NewHandler(nil)` is safe for the 401/400 tests (same pattern as
  `telemedicine/health_premium_test.go`).
- **Assertion style matches siblings:** `t.Errorf/t.Fatalf`, table-driven
  `t.Run`, no testify — identical to `ledger/service_test.go` &
  `telemedicine/*_test.go`.

**Attestation:** the three test files are expected to compile and the default
(non-tagged) suite is expected to pass under `go test ./internal/doctor/...` once
run in an environment with the Go toolchain. No execution was possible here.
