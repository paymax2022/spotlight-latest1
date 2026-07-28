# QA Review — Doctor Backend, WAVE 3b (Veterinary / Pet endpoints)

**Reviewer:** QA / Go static review (no Go toolchain available — static analysis only)
**Date:** 2026-06-21
**Module path:** `spotlight/backend`
**Scope:** `backend/internal/doctor/{model_vet.go, repository_vet.go, service_vet.go, handler_vet.go}` (NEW) + `backend/internal/app/finance_routes.go` (vet routes added).
**References:** `contracts/doctor.openapi.yaml`, `supabase/migrations/20260625000000_doctor_module.sql`, `mobile-app/reactnative/docs/DOCTOR_ENDPOINT_INVENTORY.md`, Wave 3a files.

---

## 1. Summary verdict

**PASS — APPROVED (no blockers, no majors).** Wave 3b is internally consistent, compile-shape clean, routing-safe, correctly scoped, and money-safe. The duplicate-symbol blocker that hit Wave 3a does **not** recur. The vet route family registers cleanly under the existing `/api/v1/doctor` group with no gin v1.10 panic.

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| MAJOR | 0 |
| MINOR | 2 |
| NOTE | 4 |

> **No-toolchain caveat:** `go build` / `go vet` / `go test` were NOT run (no Go toolchain in this environment). All findings are from static inspection: symbol sweeps, signature cross-matching, brace/import accounting, DDL-vs-column diffing, and route-table modeling. The final gate must still be executed in CI (command at the end).

---

## 2. Per-check findings

### Check 1 — Duplicate-symbol sweep — **PASS**

Swept the **whole** `doctor` package (all non-test `.go` files) for duplicate top-level funcs, duplicate methods on `*Handler`/`*Service`/`*Repository`, and duplicate type decls.

- `uniq -d` over every `func [(recv)] Name(` → **empty**. No duplicate function or method names anywhere in the package.
- The four new files do **NOT** redeclare any shared helper or sentinel. Confirmed each is defined exactly once, outside the vet files:
  - `strOrDefault` → `repository.go:896`
  - `jsonOrEmptyObject` → `repository.go:850`
  - `jsonOrEmptyArray` → `repository.go:843`
  - `derefStr` → `service.go:225`
  - `parseClinicalPatch` → `service_clinical.go:44`
  - `ErrNotFound` → `repository.go:26`
  - `ErrIdempotencyRequired` → `service.go:40`
  - `h.userID` → `handler.go:21`, `h.fail` → `handler.go:32`, `h.idemKey` → `handler.go:47`, `h.rawBody` → `handler_account.go:21`
- New helper `vetEcho` (`service_vet.go:30`) is unique to the package — no collision.

**Verdict: clean. The Wave 3a duplicate-symbol class of blocker is NOT present.**

### Check 2 — Compile-shape — **PASS**

- Every `h.svc.X` in `handler_vet.go` resolves to a real `func (s *Service) X` (set-difference against all Service methods in the package = empty).
- Every `s.repo.X` in `service_vet.go` resolves to a real `func (r *Repository) X` (set-difference = empty).
- `Handler{ svc *Service }` (`handler.go:16`), `Service{ repo *Repository }` (`service.go:25`), `Repository{ db *pgxpool.Pool }` (`repository.go:17`) — receiver field names match usage.
- `AddPetLabInterpretation` (`service_vet.go:354`) uses `parseClinicalPatch(raw)` then `p.Interpretation` / `p.Body` — both fields exist on `clinicalPatch` (`service_clinical.go:7,18`). ✔
- Request structs: all inline anonymous structs (`ToggleVetMode`, `CreatePetPrescription`, `CreatePetLabOrder`, `SetPetVaccinationReminder`, `RecommendPetProducts`) are self-contained. ✔
- Imports all used: `model_vet.go` (time, json), `service_vet.go` (context, json, time), `repository_vet.go` (context, errors, time, uuid, pgx), `handler_vet.go` (net/http, gin). No unused imports → no Go compile error from that axis.
- Braces balanced in all four files (model 14/14, handler 166/166, service 124/124, repo 137/137).

### Check 3 — Routing safety (gin v1.10.0) — **PASS (per-family)**

Confirmed gin version `v1.10.0` in `go.mod`. Modeled the **full** doctor route tree (194 registrations) as a radix tree per HTTP method.

- **Duplicate method+path:** `uniq -d` over all 194 `docGroup.<METHOD>("path")` → **empty**. Zero duplicate routes.
- **Param-name collisions (the real gin panic):** scanned every position under every shared `(method, parent)` prefix for two *different* `:param` names at the same depth → **NONE**. This is the only condition that panics gin's tree at registration.
- **Static-vs-param coexistence:** ~10 prefixes mix a static child and a param child at the same position (e.g. `/lab-results/inbox` + `/lab-results/:resultId/...`, `/vet/consults/history` + `/vet/consults/:consultId/...`, `/vet/products/:productId` + the static `/vet/products`). gin v1.7+ (radix tree) **supports** static+wildcard siblings at one node; these are not panics, and the pre-existing Wave 3a routes already exercise the identical pattern.

**New `:param` families introduced by Wave 3b — per-family verdict:**

| Family | Used at | Single consistent name? | Verdict |
|---|---|---|---|
| `:petId` | `/vet/pets/:petId/...` (15 routes) | yes — never mixed with `:id` under `/vet/pets` | PASS |
| `:prescriptionId` | `/vet/prescriptions/:prescriptionId/{issued,issue,send}` | yes | PASS |
| `:orderId` | `/vet/lab-orders/:orderId/result` | yes (matches existing `/lab-orders/:orderId/*`) | PASS |
| `:resultId` | `/vet/lab-results/:resultId/{review,interpretation}` | yes | PASS |
| `:refillId` | `/vet/refills/:refillId/review` | yes | PASS |
| `:requestId` | `/vet/requests/:requestId/respond` | yes | PASS |
| `:recommendationId` | `/vet/recommendations/:recommendationId/share` | yes | PASS |
| `:consultId` | `/vet/consults/:consultId/summary` | yes | PASS |
| `:productId` | `/vet/products/:productId` | yes | PASS |
| `:id` | `/vet/product-fulfilments/:id` | yes (isolated subtree) | PASS |

No `:petId` vs `:id` (or any) cross-name collision exists under any shared prefix. **Routing verdict: SAFE — 0 duplicate routes, 0 param-name collisions, 0 gin registration panics.**

### Check 4 — Scoping — **PASS**

Every vet read/write is scoped by `user_id`; per-pet operations confirm pet ownership via `GetPet` (which is itself `WHERE id=$1 AND user_id=$2`) before touching child data. Spot-check of 8 functions (WHERE quoted):

1. `GetVetProfile` (repo:34) — `WHERE user_id = $1`
2. `GetPet` (repo:88) — `WHERE id = $1 AND user_id = $2`
3. `ListPetVaccinations` (repo:119) — `WHERE user_id = $1 AND pet_id = $2`
4. `GetPetPrescriptionForPet` (repo:272) — `WHERE user_id = $1 AND pet_id = $2 ...`
5. `GetPetLabResultForOrder` (repo:424) — `WHERE order_id = $1 AND user_id = $2 ...`
6. `ReviewPetLabResult` (repo:438) — `WHERE id = $1 AND user_id = $2 AND reviewed = false`
7. `ListPetRecommendationsForPet` (repo:527) — `WHERE user_id = $1 AND pet_id = $2`
8. `GetPetFulfilment` (repo:630) — `WHERE id = $1 AND user_id = $2`

The empty-projection "no-table" reads that take a `petId` (`GetPetChatThread`, `GetPetCallSession`, `GetPetSoapNote`, `ListPetEmergencyWarnings`, `ListPetReferrals`, `ListPetChronicMonitoring`) all call `s.repo.GetPet(...)` first (service:96/104/112/128/142/448) so an unowned pet returns `ErrNotFound` rather than a blank 200. **No unscoped read or write found.**

### Check 5 — Idempotency — **PASS**

All mutations require the `Idempotency-Key` header (service returns `ErrIdempotencyRequired` when empty). Tables with a `UNIQUE idempotency_key` use header + `ON CONFLICT (idempotency_key) DO NOTHING` + replay-by-idem read. State transitions are status-guarded scoped UPDATEs (naturally idempotent). No-table writes still require the header and echo the body — they do **not** query a phantom table.

| Mutation | Backing table | Idempotency mechanism |
|---|---|---|
| `ToggleVetMode` | doctor_vet_profiles | header + `ON CONFLICT (user_id)` upsert (repo:50) |
| `RecordPetGrowth` | doctor_pets | header + scoped UPDATE append (repo:102) — see MINOR-2 |
| `CreatePetPrescription` | doctor_pet_prescriptions | header + `ON CONFLICT (idempotency_key)` + replay (repo:242) |
| `IssuePetPrescription` | doctor_pet_prescriptions | header + guarded UPDATE `status='draft'` (repo:286) |
| `SendPetPrescription` | doctor_pet_prescriptions | header + guarded UPDATE `status='issued'` (repo:306) |
| `CreatePetLabOrder` | doctor_pet_lab_orders | header + `ON CONFLICT (idempotency_key)` + replay (repo:345) |
| `ReviewPetLabResult` | doctor_pet_lab_results | header + guarded UPDATE `reviewed=false` (repo:438) |
| `AddPetLabInterpretation` | doctor_pet_lab_results | header + idempotent overwrite UPDATE (repo:455) |
| `SetPetVaccinationReminder` | doctor_pet_vaccinations | header + `ON CONFLICT (idempotency_key)` + replay (repo:163) |
| `RecommendPetProducts` | doctor_pet_recommendations | header + `ON CONFLICT (idempotency_key)` + replay (repo:549) |
| `SharePetRecommendation` | doctor_pet_recommendations | header + guarded UPDATE → shared (repo:592) |
| `RespondToOwnerRequest` | **none** (echo) | header required, `vetEcho(raw)` — no table queried (service:88) |
| `SaveVetSoapNote` | **none** (echo) | header required, `vetEcho(raw)` (service:120) |
| `CreateVetReferral` | **none** (echo) | header required, `vetEcho(raw)` (service:149) |
| `RequestPetRefill` | **none** (echo) | header required, `vetEcho(raw)` (service:289) |
| `ReviewPetRefill` | **none** (echo) | header required, `vetEcho(raw)` (service:297) |
| `SavePetChronicMonitoring` | **none** (echo) | header required + `GetPet` ownership check, `vetEcho(raw)` (service:455) |

### Check 6 — Struct ↔ column — **PASS**

All 9 vet/pet tables exist in the migration (lines 795–914) and their columns match the repo SELECT/INSERT/UPDATE lists exactly:

- `doctor_vet_profiles` (795): id, user_id, vet_mode_enabled, licence_number, verification, is_published, profile_draft, detail, created_at, updated_at — matches repo:36.
- `doctor_pets` (810): id, user_id, owner_ref, name, species, breed, profile, growth_history, created_at, updated_at — matches repo:69.
- `doctor_pet_vaccinations` (824): id, pet_id, user_id, vaccine, due_at, administered_at, reminder_set, detail, idempotency_key, created_at — matches repo:121.
- `doctor_pet_prescriptions` (838): id, user_id, pet_id, ref, status, items, issued_at, idempotency_key, created_at, updated_at — matches repo:209.
- `doctor_pet_lab_orders` (853): id, user_id, pet_id, ref, status, tests, idempotency_key, created_at, updated_at — matches repo:325.
- `doctor_pet_lab_results` (866): id, user_id, order_id, reviewed, reviewed_at, **values**, interpretation, created_at, updated_at — matches repo:391.
- `doctor_pet_products` (879): id, user_id, name, category, price_kobo (bigint), detail, created_at — matches repo:474.
- `doctor_pet_recommendations` (890): id, user_id, pet_id, product_id, status, shared_at, detail, idempotency_key, created_at — matches repo:507.
- `doctor_pet_fulfilments` (903): id, user_id, product_id, pet_id, status, total_kobo (bigint), detail, created_at, updated_at — matches repo:611.

**Reserved word `values`:** all 3 references in `repository_vet.go` (lines 391, 412, 426) quote it as `"values"`. No unquoted occurrence found. ✔ (This is a real bug class — verified clean.)

**Empty-projection reads do not SELECT from any non-existent table** — they return `[]json.RawMessage{}` / `json.RawMessage("{}")` in the service with no repo call (or only `GetPet`). No phantom-table query exists.

### Check 7 — Money — **PASS**

No ledger postings anywhere in Wave 3b (no `ledger`, no balance writes). `price_kobo` and `total_kobo` are `bigint` in DDL and `int64` in models (`PetProduct.PriceKobo`, `PetFulfilment.TotalKobo`), read-only — never mutated, never summed into a balance. No floats, no string math. Comment in `model_vet.go:16-19` and `repository_vet.go:22-24` explicitly states no value movement. Compliant with the kobo/no-floats iron rule.

### Check 8 — Additive scope — **PASS**

Changes confined to the 4 new files plus the vet-route block appended to the existing doctor section of `finance_routes.go` (lines ~845–905). No existing Spotlight/legacy module touched; no migration edited; no DROP/rename.

---

## 3. Final backend-completeness summary

### Registered routes
- **Total `/api/v1/doctor` routes registered in `finance_routes.go`: 194** (all `docGroup.<METHOD>(...)` registrations: MVP + Wave 2 + Wave 3a + Wave 3b).
- **Wave 3b vet routes: 48** of those 194.

### Against the contract & inventory
- `contracts/doctor.openapi.yaml`: **276 path templates / 313 operations**.
- `DOCTOR_ENDPOINT_INVENTORY.md`: **309 live endpoints** across 11 modules (MVP, Phase 2, Phase 3, Profile/Section B, Batch 1–7).
- **Implemented (live, wired, non-stub): 194 / 309 ≈ 63% of the inventory** (≈ 62% of the 313 contract operations).
- **Stubbed:** `routes_remaining.go` contains ~10 representative `501 stubNotImplemented` routes and is **NOT wired** into `finance_routes.go` (its `RegisterRemaining` has zero call sites) — so it neither contributes routes nor risks a double-registration panic. The remaining ~115 inventory endpoints are effectively *not yet wired* (documented TODOs).
- **Reference-empty:** a subset of the 194 wired routes are "no-table" reference endpoints (vet appointments, owner-requests, chat/call/soap-note reads, emergency warnings, specialists, referrals, consult summary/history, pharmacies, refills, lab-catalogue, chronic-monitoring) that return empty projections / echo bodies by design — wired and contract-shaped, but with no persistence target.

### Inventory groups NOT yet wired (no live routes)
- **Batch 1 — Schedule/Queue** (blocked-dates, vacations, recurring availability, queue) — only stubbed in `routes_remaining.go`.
- **Phase 2 / Batch 2 — Chat threads & messages, Call sessions** (`/chat/threads`, `/chat/:threadId/messages`, `/calls/:appointmentId`) — stubbed only.
- **Phase 3 — AI care / practice analytics** (`/reputation`, AI-triage, practice-mgmt) — not wired.
- **Batch 6/7 partial** — earnings *breakdown*, some quality/compliance sub-routes — not wired (core notifications/support/security/privacy/quality ARE wired).
- **MVP `/payouts`** is wired, but money-adjacent HMO claims submission (`POST /hmo/claims`) remains a stub.

### Migration coverage
The migration defines **81 `doctor_*` tables**. Every **implemented** endpoint maps onto an existing table (verified for all 9 vet/pet tables in Check 6; Wave 2/3a tables verified in prior reviews). **No implemented endpoint references a missing table.** Reference-empty endpoints intentionally have no table. The ~115 un-wired inventory endpoints also map 1:1 onto already-created tables per `routes_remaining.go`, so **no further migration is required** to finish them.

### Overall backend readiness
- **Schema:** complete (81 tables, additive single migration). ✔
- **Contract:** present and authoritative (313 ops). ✔
- **MVP (money path):** wired (profile, appointments, prescriptions, lab orders/results, earnings, payouts). ✔
- **Wave 2 (account/onboarding/profile/notifications/support/security/quality):** wired. ✔
- **Wave 3a (pharmacy, labs-extended, referrals, follow-up, HMO, records):** wired. ✔
- **Wave 3b (veterinary / pet):** wired and reviewed here — **clean**. ✔
- **Gap:** ~37% of the inventory (schedule, chat/calls, AI/practice, HMO-claims submission) remains stubbed/un-wired — feature-incomplete but not blocking; expand via the `SCAFFOLD.md` pattern, no schema work needed.

**Net:** the doctor backend is a coherent, money-safe, routing-safe **63%-of-inventory** build with all four waves landed. Readiness is "MVP + 3 waves complete; remaining endpoints scaffolded."

---

## 4. Prioritized defect list (describe — do not apply)

No BLOCKER or MAJOR defects.

**MINOR-1 — Dead status-guard fall-through (cosmetic, not a bug).** In `IssuePetPrescription` (repo:286), `SendPetPrescription` (repo:306), and `ReviewPetLabResult` (repo:438) the `if tag.RowsAffected() == 0 { return r.Get...() }` branch and the trailing `return r.Get...()` are identical, so the guard is a no-op. Behavior is correct (idempotent replay), but the dead branch is confusing — collapse to a single return. *Location: repository_vet.go:295-299, 315-318, 447-451.*

**MINOR-2 — `RecordPetGrowth` is not idempotent on replay.** It requires the header (good) but `AppendPetGrowth` does an unconditional `growth_history || $3` append with no idempotency_key on `doctor_pets`, so a retried request appends the measurement twice. For a money-path this would be a defect; for a clinical append it is low-risk but technically violates the "header ⇒ idempotent" contract the other mutations honor. Consider de-duping by a measurement id or moving growth to its own keyed table. *Location: service_vet.go:224 / repository_vet.go:102.*

**NOTE-1.** `SendPetPrescription` ignores the request payload at the persistence layer (no pet-pharmacy table) — documented in repo:302-305. Intentional; contract returns the transitioned prescription.

**NOTE-2.** Many wired vet endpoints are reference-empty (return `[]`/`{}`). This is by design (no backing table) and clearly enumerated in `service_vet.go` / `repository_vet.go` headers, but consumers should expect empty data, not 404.

**NOTE-3.** `routes_remaining.go` still declares `g.GET("/vet/dashboard")` and `g.POST("/vet/pets/:petId/prescription")` as stubs. Because `RegisterRemaining` is never invoked there is no conflict — but once it is wired, those two lines will collide with the now-real Wave 3b routes and must be removed first.

**NOTE-4.** No Go toolchain was available; the final compile/vet/test gate has not been executed.

---

## 5. Run in CI (mandatory gate)

```sh
cd backend && go build ./... && go vet ./internal/doctor/... && go test ./internal/doctor/...
```

This must pass before merge. Static review predicts a clean build (all symbols unique, all signatures matched, all imports used, all braces balanced, routing tree conflict-free), but the toolchain is the source of truth.
