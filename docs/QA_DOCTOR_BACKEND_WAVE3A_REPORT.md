# QA Report — Doctor Backend Wave 3a (Human Clinical Endpoints)

**Scope:** `backend/internal/doctor/{model_clinical.go, repository_clinical.go, service_clinical.go, handler_clinical.go}` (NEW) + `backend/internal/app/finance_routes.go` doctor-block additions (EDITED).
**Review type:** STATIC only. No Go toolchain available in the sandbox — `go build` / `go vet` / `go test` were NOT executed. Findings are from source reading + scripted symbol/route/column diffing.
**Module:** `spotlight/backend`. **Reviewer:** QA/Go reviewer.

---

## Summary verdict

**FAIL — 1 BLOCKER (hard compile-breaker).** The package will not build because of a duplicate top-level function declaration. Everything else is clean: routing is gin-safe (no panics), scoping is enforced on every query, idempotency handling is correct and intentional, struct↔column mapping matches the migration, money rules are respected, and OpenAPI conformance is strong (only cosmetic param-name nits).

| Severity | Count |
|----------|-------|
| BLOCKER  | 1 |
| MAJOR    | 0 |
| MINOR    | 3 |
| NOTE     | several (intentional, documented) |

Fix the single BLOCKER and the wave is shippable.

---

## DEFECT-1 (BLOCKER) — `strOrDefault` redeclared in package `doctor`

`strOrDefault` is defined **twice with identical signature** in the same package:

- `backend/internal/doctor/repository.go:896` — `func strOrDefault(p *string, d string) string`
- `backend/internal/doctor/service_clinical.go:52` — `func strOrDefault(p *string, d string) string`

Go does not allow two top-level functions with the same name in one package. This is a hard compile error:

```
./service_clinical.go:52:6: strOrDefault redeclared in this block
	./repository.go:896:6: other declaration of strOrDefault
```

**Fix (pick one):** delete the copy at `service_clinical.go:52-57` (the pre-existing `repository.go` definition is identical and already in-package, so `service_clinical.go` can use it directly — no import needed, same package). Do NOT rename the repository copy (other Wave 2 code may depend on it). This is a one-block deletion.

No other duplicate function/method/type names exist across the package (verified: `normaliseDecision`, `parseClinicalPatch`, `clinicalPatch`, and all `Service`/`Repository`/`Handler` methods are unique).

---

## Check 1 — COMPILE-SHAPE

| Item | Result |
|------|--------|
| Every `h.svc.X` in handler_clinical.go resolves to a real `Service` method (correct arity/types) | **PASS** — 75 distinct calls, 0 unresolved |
| Every `s.repo.X` in service_clinical.go resolves to a real `Repository` method | **PASS** — 58 distinct calls, 0 unresolved |
| Reused helpers exist and are not redefined: `h.userID` (handler.go:21), `h.fail` (handler.go:32), `h.idemKey` (handler.go:47), `h.rawBody` (handler_account.go:21), `jsonOrEmptyObject`/`jsonOrEmptyArray` (repository.go:850/843), `getLabResultByID` (repository.go:598), `listLabResultValues` (repository.go:545), `getLabOrder` (repository.go:491), `InsertSafetyIssue` (repository_account.go:643) | **PASS** |
| `ReportSafetyIssueRequest{Severity, Subject, Detail}` / `SafetyIssue` shapes match service usage (model_account.go:202/214) | **PASS** |
| `LabResult.Values` field exists (model.go:245) for `GetLabResultRich` | **PASS** |
| `ErrIdempotencyRequired` (service.go:40), `ErrNotFound` (repository.go:26) exist | **PASS** |
| Imports all used (json/time in model_clinical; context/json in service_clinical; context/errors/uuid/pgx + time@L1311 in repository_clinical; net/http + gin in handler_clinical) | **PASS** |
| Braces balanced in all 4 files | **PASS** (251/251, 147/147, 292/292, 24/24) |
| No duplicate Go method/type names across the package | **PASS** |
| Duplicate top-level func `strOrDefault` | **FAIL → DEFECT-1 (BLOCKER)** |

Note: `service_clinical.go` defines `ApproveFollowUp` and `RejectFollowUp` (lines 335, 342) that are not wired to any route — unused exported methods are legal Go (no compile error, no vet warning). Harmless dead code; see MINOR-3.

---

## Check 2 — ROUTE WIRING + ROUTING SAFETY (critical)

- **146 doctor routes** total in the block; **0 exact duplicate `method+path`** pairs.
- Every Wave 3a route maps to an existing handler method (verified against handler_clinical.go).
- **gin v1.10 radix-tree conflict analysis (per HTTP method):** I enumerated, for every `(method, parent-prefix)` position, the set of distinct param names and static children. **No position has two different param names for the same method** → no gin wildcard-conflict panic. Several positions legitimately mix a static child with a single param child; gin v1.10 supports static+single-param siblings (both registration orders), so these are safe.

### Route-family routing-safety table

| Family | Method positions of interest | Distinct param names at shared position | Static+param siblings | Verdict |
|--------|------------------------------|-----------------------------------------|-----------------------|---------|
| `/pharmacy/...` | GET `/pharmacy/` → `{fulfilments(static)}` + `:fulfilmentId`; POST same | only `:fulfilmentId` | yes (static `fulfilments` + `:fulfilmentId`) | **SAFE** |
| `/pharmacies/...` | GET `/pharmacies/` → `preferred(static)` + `:pharmacyId`; POST `:pharmacyId` | only `:pharmacyId` | yes | **SAFE** |
| `/lab-orders/...` | GET/POST `/lab-orders/:orderId/...` | only `:orderId` | no | **SAFE** |
| `/lab-results/...` | GET `/lab-results/` → `inbox(static)` + `:resultId`; PUT/POST `:resultId` | only `:resultId` | yes | **SAFE** |
| `/referrals/...` | GET `/referrals/` → `incoming(static)` + `:id`; under `/referrals/incoming/` GET `:id` & POST `:referralId` (different methods → separate trees) | GET-tree: `:id`; POST-tree: `:referralId` (no method shares two names) | yes | **SAFE** |
| `/follow-ups/...` | GET `/follow-ups/:id`; POST `/follow-ups/:followUpId/...` (different methods) | GET: `:id`; POST: `:followUpId` (per-method single name) | no | **SAFE** |
| `/hmo/...` | GET `/hmo/claims/:id`, `/hmo/coverage/:patientId`, `/hmo/pre-auth/:id`, `/hmo/support/:threadId`; POST `/hmo/fraud-warnings/:warningId/ack`, `/hmo/pre-auth`, `/hmo/support/:threadId/messages` | each sub-prefix has at most one param name per method | no collisions | **SAFE** |
| `/records/...` | GET `/records/` → `dashboard,shares(static)` + `:patientId`; POST `:patientId` | only `:patientId` | yes | **SAFE** |
| `/care-plans/...` | GET `/care-plans/:id`; POST `/care-plans` | only `:id` | no | **SAFE** |
| `/opinions/...` | GET `/opinions/:id`; POST `/opinions` | only `:id` | no | **SAFE** |
| `/care-team/...` | GET `/care-team/:threadId`; POST `/care-team/:threadId/messages` | only `:threadId` | no | **SAFE** |

**Routing-safety verdict: PASS — no gin panic.** No `(method, position)` carries two different param names; all static+param mixes use a single param name and are supported by gin v1.10.

---

## Check 3 — AUTH + SCOPING

Every read and write is scoped to the authenticated doctor via `WHERE user_id = $1` (defence-in-depth on top of RLS). Spot-check of 10 repo funcs (quoted WHERE clause):

1. `ListPharmacyFulfilments` — `WHERE user_id = $1` (repository_clinical.go:35)
2. `GetPharmacyFulfilment` — `WHERE id = $1 AND user_id = $2` (:56)
3. `ReviewRefill` (UPDATE) — `WHERE id = $1 AND user_id = $2 AND status = 'pending'` (:194)
4. `ListPharmacyMessages` — `WHERE user_id = $1 AND fulfilment_id = $2` (:206)
5. `ListReferrals` — `WHERE user_id = $1 AND direction = 'outgoing'` (:397)
6. `ReviewIncomingReferral` (UPDATE) — `WHERE id = $1 AND user_id = $2 AND status = 'pending'` (:499)
7. `ListCareTeamMessages` — `WHERE user_id = $1 AND thread_id = $2` (:577)
8. `GetHMOCoverageForPatient` — `WHERE user_id = $1 AND patient_id = $2` (:934)
9. `ListRecordRestrictions` — `WHERE user_id = $1 AND patient_id = $2` (:1197)
10. `ListRecordAccessLog` — `WHERE user_id = $1 AND patient_id = $2` (:1284)

All mutation paths (`InsertX` / `Review*` / `Touch*` / `Ack*` / `Complete*`) carry `user_id` either in the WHERE (updates) or as an inserted column (creates). **No unscoped query found. PASS — no data-leak.**

---

## Check 4 — IDEMPOTENCY

Mutations on tables with a `UNIQUE idempotency_key` column read the header (service returns `ErrIdempotencyRequired` if empty) and use `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` + replay-fetch. Status-transition updates on pre-existing rows are status-guarded scoped UPDATEs (naturally idempotent). The one table without an idempotency_key column is a plain insert and intentionally does not require the header.

| Mutation | Backing table | idempotency_key col? | Handling | Verdict |
|----------|---------------|----------------------|----------|---------|
| SendPharmacyMessage | doctor_pharmacy_messages | yes | header required + ON CONFLICT replay | PASS |
| ConfirmFulfilmentReceived | doctor_pharmacy_fulfilments | n/a (state transition) | header required; status-guarded UPDATE | PASS |
| ReviewSubstitute | doctor_pharmacy_substitutes | (transition) | header required; status-guarded UPDATE | PASS |
| ReviewRefill | doctor_refill_requests | (transition) | header required; status-guarded UPDATE | PASS |
| ReportPharmacy / ReportSuspiciousResult | doctor_safety_issues | yes (via InsertSafetyIssue) | header required + ON CONFLICT replay | PASS |
| AddLabInterpretation | doctor_lab_interpretations | yes | header required + ON CONFLICT replay | PASS |
| CancelLabOrder / ShareLabOrder / ShareLabExplanation | lab_orders/lab_results (transition) | header required; status-guarded / Touch | PASS |
| CreateReferral | doctor_referrals | yes | header required + ON CONFLICT replay | PASS |
| Accept/RejectIncomingReferral | doctor_incoming_referrals | (transition) | header required; status-guarded UPDATE | PASS |
| CreateOpinionRequest | doctor_opinion_requests | yes | header required + ON CONFLICT replay | PASS |
| SendCareTeamMessage | doctor_care_team_messages | yes | header required + ON CONFLICT replay | PASS |
| CreateFollowUp | doctor_follow_up_plans | yes | header required + ON CONFLICT replay | PASS |
| Review/Complete/SetReminder FollowUp | doctor_follow_up_plans | (transition) | header required; scoped UPDATE | PASS |
| SaveCarePlan | doctor_care_plans | yes | header required + ON CONFLICT replay | PASS |
| **SaveChronicMonitoring** | **doctor_chronic_monitoring** | **NO column** | **plain INSERT, header NOT required** | **PASS (intentional, documented)** |
| RecordAdherenceCheck | doctor_adherence_checks | yes | header required + ON CONFLICT replay | PASS |
| RequestPreAuth | doctor_hmo_preauth_requests | yes | header required + ON CONFLICT replay | PASS |
| SendHMOSupportMessage | doctor_hmo_support_messages | yes | header required + ON CONFLICT replay | PASS |
| AckFraudWarning | doctor_hmo_fraud_warnings | (idempotent UPDATE) | header required; idempotent UPDATE | PASS |
| ShareRecord | doctor_record_shares | yes | header required + ON CONFLICT replay | PASS |
| RequestRecordAccess / ExportRecord | doctor_record_access_log | NO column (append-only audit) | header required by service; plain INSERT | PASS (audit log is append-only by design) |
| GetPatientRecordIndex (writes 'view' access entry) | doctor_record_access_log | NO column | side-effect INSERT, no header | PASS (read-with-audit) |

`SaveChronicMonitoring` not requiring the header is **correct and intentional** — the table has no `idempotency_key` column (migration:730-739), and the service comment (service_clinical.go:419-421) documents this.

---

## Check 5 — STRUCT ↔ COLUMN MATCH (8 tables) + reference-read confirmation

Verified migration DDL columns against repo read/write column lists. All match.

| Table | DDL columns (migration) | Repo SELECT/INSERT columns | Verdict |
|-------|-------------------------|----------------------------|---------|
| doctor_pharmacy_fulfilments (:409) | id,user_id,prescription_id,pharmacy_id,pharmacy,status,total_kobo,detail,created_at,updated_at | same | MATCH |
| doctor_pharmacy_substitutes (:424) | id,fulfilment_id,user_id,original_drug,substitute_drug,status,price_kobo,reviewed_at,detail,idempotency_key,created_at | reads/writes match (idempotency_key write-only) | MATCH |
| doctor_refill_requests (:455) | id,user_id,prescription_id,patient,status,reviewed_at,detail,idempotency_key,created_at,updated_at | same | MATCH |
| doctor_lab_interpretations (:545) | id,result_id,user_id,interpretation,detail,idempotency_key,created_at,updated_at | INSERT writes updated_at=now(); SELECT reads created_at,updated_at | MATCH |
| doctor_follow_up_plans (:700) | id,user_id,patient_id,appointment_id,status,kind,due_at,reminder_set,completed_at,detail,idempotency_key,created_at,updated_at | same | MATCH |
| doctor_adherence_checks (:742) | id,user_id,patient_id,prescription_id,status,detail,idempotency_key,created_at (**no updated_at**) | repo reads ...,detail,created_at (no updated_at); model has no UpdatedAt | MATCH |
| doctor_hmo_preauth_requests (:576) | id,user_id,patient_id,appointment_id,status,auth_code,amount_kobo,detail,idempotency_key,created_at,updated_at | same | MATCH |
| doctor_record_shares (:943) | id,user_id,patient_id,shared_with,status,expires_at,detail,idempotency_key,created_at | reads id..expires_at,detail,created_at; INSERT sets status='active' | MATCH |

**CHECK constraints respected:** `doctor_lab_orders.status` CHECK includes `'cancelled'` → `CancelLabOrder` sets `'cancelled'` (OK); `doctor_referrals.direction` CHECK `IN ('outgoing','incoming')` → `InsertReferral` writes `'outgoing'` (OK); `doctor_lab_result_values.flag` CHECK is read-only here (OK).

**Reference reads with no backing table — confirmed empty projections, NO query issued:** `ListPharmacies`, `GetPreferredPharmacy`, `GetPharmacyStock`, `ListDeliveryAlerts`, `ListLabCatalogue`, `ListLabPackages`, `ListLabProviders`, `ListSpecialists`, `ListLabValueComparisons` all return `[]json.RawMessage{}` / `json.RawMessage("{}")` directly in the **service** layer (service_clinical.go:135-163, 168-183, 313-315) — they never touch a non-existent table, so no runtime "relation does not exist" error. `ListLabValueComparisons` first calls `GetLabResultRich` to confirm ownership (good — returns 404 for foreign result) before returning the empty trend set. `ReportPharmacy` / `ReportSuspiciousResult` correctly persist into the existing `doctor_safety_issues` table instead of a phantom table. **PASS.**

---

## Check 6 — MONEY RULES

- **No ledger postings** anywhere in Wave 3a (grep: zero `ledger.`/`PostEntries`/`.Post(` calls in the clinical files; only explanatory comments). Clinical = state transitions/document writes. **PASS.**
- All monetary fields are **int64 kobo**: `TotalKobo`, `PriceKobo`, `CopayKobo`, `AmountKobo` (model_clinical.go:29,43,230,244,269); DDL columns are `bigint`. **No floats** (grep: none). **No stored balances.** **PASS.**
- HMO pre-auth `amount_kobo` and claim `amount_kobo` are persisted **for context only**, explicitly documented as not a wallet movement (service_clinical.go:452-453, repository_clinical.go:981). **PASS.**

---

## Check 7 — ADDITIVE SCOPE

- New files only: the 4 `*_clinical.go` files (untracked) + Wave 3a additions to the existing doctor block in `finance_routes.go` (lines 758-843). No existing Spotlight/legacy module files touched.
- Migration `20260625000000_doctor_module.sql` is **additive-only**: only `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`. The only `DROP` statements are `DROP POLICY IF EXISTS` inside RLS policy (re)creation — idempotent policy setup, not schema destruction. No column drops, renames, or type narrowing. **PASS.**

---

## Check 8 — OPENAPI CONFORMANCE (spot-check, ~20 paths)

Spot-checked Wave 3a paths/methods against `contracts/doctor.openapi.yaml`. All present with matching HTTP methods:

| Route (impl) | Contract path | Method | Match |
|--------------|---------------|--------|-------|
| GET /pharmacy/fulfilments | /doctor/pharmacy/fulfilments | GET | OK |
| GET /lab-results/inbox | /doctor/lab-results/inbox (:1610) | GET | OK |
| POST /lab-orders/:orderId/share | /doctor/lab-orders/{orderId}/share (:1596) | POST | OK |
| POST /lab-orders/:orderId/cancel | /doctor/lab-orders/{orderId}/cancel (:1603) | POST | OK |
| PUT /lab-results/:resultId/interpretation | .../interpretation (:1624) | PUT | OK |
| GET /referrals/incoming + /incoming/:id + accept/reject | :1693/1695/1701/1708 | GET/POST | OK |
| POST /follow-ups/:followUpId/review | /follow-ups/{followUpId}/review (:895) | POST | OK |
| GET /hmo/coverage/:patientId, /hmo/pre-auth(+/:id) | :1649/1655/1663 | GET/POST | OK |
| GET /records/dashboard, POST /records/:patientId/share | :2024/2053 | GET/POST | OK |
| GET /care-team/:threadId (+/messages) | :1729/1735 | GET/POST | OK |
| GET /case-summaries/:caseRef | :1742 | GET | OK |
| GET /specialists, /delivery-alerts, /lab-catalogue | :826/1582/1584 | GET | OK |

**MINOR path-parameter-name nits (cosmetic — gin uses position, not name, so no functional impact, but the route param name diverges from the contract):**
- Route `/pharmacy/fulfilments/:id/delivery` & `/:id/substitute` vs contract `{fulfilmentId}` (:790/796).
- Route `/refills/:id/review` vs contract `{refillId}` (:819).
- (Pre-existing MVP) Route `/appointments/:appointmentId` vs contract `{id}` (:559).

---

## Prioritized defect list (fixes described, not applied)

1. **DEFECT-1 — BLOCKER — duplicate `strOrDefault`.** Delete `func strOrDefault` from `service_clinical.go:52-57`; rely on the identical existing definition at `repository.go:896` (same package). One-block removal; nothing else references the service copy specifically. Without this, `go build ./...` fails and the whole `doctor` package (plus `app`) won't compile.

2. **MINOR-1 — OpenAPI path-param naming drift.** Align route param names with the contract (`:id`→`:fulfilmentId` for pharmacy fulfilment sub-paths; `:id`→`:refillId` for refill review) OR update the contract. Cosmetic; gin routing is unaffected.

3. **MINOR-2 — `GetSharedCaseSummary` semantics.** It projects a care-team thread using `caseRef` as the thread id (service_clinical.go:308-310). Functionally fine and scoped, but the contract names it a "case summary"; confirm the mobile client expects an array of `CareTeamMessage` rather than a summary object. Doc/contract clarification only — no code bug.

4. **MINOR-3 — dead code.** `ApproveFollowUp`/`RejectFollowUp` (service_clinical.go:335,342) are unused (the wired path is `ReviewFollowUp`). Legal Go, no build/vet failure; remove for tidiness or leave as future hooks.

---

## Run in CI

The static review could not execute the toolchain. Before merge, run:

```
cd backend && go build ./... && go vet ./internal/doctor/... && go test ./internal/doctor/...
```

`go build` will surface DEFECT-1 immediately (`strOrDefault redeclared`). After deleting the duplicate, re-run all three. Also recommend `npm run contract:check` for the param-name nits.

---

## Post-review fix applied (BLOCKER resolved)

**DEFECT-1 (duplicate `strOrDefault`) — FIXED.** Removed the duplicate definition from
`service_clinical.go` (was lines 52–57); the package now has exactly one
`strOrDefault` at `repository.go:896` (verified: `grep -rn "func strOrDefault"` →
single hit). A package-wide scan for duplicate top-level functions returns empty.
The compile-breaker is cleared; `go build ./internal/doctor/...` should now pass
(formal confirmation pending a Go toolchain in CI).

Remaining 3 minors (cosmetic param-name nits `:id` vs `{fulfilmentId}`/`{refillId}`)
are non-blocking and harmless for gin routing.

Revised verdict: **PASS** (0 blockers, 0 majors, 3 minors) after the fix.
