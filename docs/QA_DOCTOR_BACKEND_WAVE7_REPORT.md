# QA Report — Doctor Backend, Wave 7 (Final Static Review)

**Scope:** `backend/internal/doctor/*` + `backend/internal/app/finance_routes.go`
+ `backend/internal/config/config.go`, after Wave 7 (full coverage reconciliation:
294 routes; +67 tail endpoints; LLM rate guard + 429; pet-growth idempotency;
3 gin param-name normalizations; `routes_remaining.go` emptied).
**Method:** STATIC ONLY — no Go toolchain available in this environment. All
findings are from source inspection + scripted route-tree analysis. A green
`go build` / `go vet` / `go test` run in CI is still required (see end).
**Module:** `spotlight/backend`. **Reviewer pass date:** 2026-06-22.

---

## 1. Summary verdict

| Severity | Count |
| --- | ---: |
| **BLOCKER** | **0** |
| Major | 1 |
| Minor | 1 |

**Overall: PASS with one MAJOR documentation-accuracy defect.**
No router-panic conflicts. No unresolved symbols. No duplicate symbols. No
duplicate routes. Rate guard, pet-growth idempotency, and security all PASS.
The single MAJOR is that `docs/DOCTOR_ENDPOINT_COVERAGE.md` materially
misstates coverage numbers vs the current `contracts/doctor.openapi.yaml`
(details in §8). It is a doc defect, not a code/compile/router defect.

---

## 2. HEADLINE — Gin route safety, FULL SET (all 294 routes)

**VERDICT: 0 conflicts. SAFE. The router will not panic.**

Extracted all 294 registered routes:
`grep -oE 'docGroup\.(GET|POST|PUT|DELETE|PATCH)\("[^"]+"' backend/internal/app/finance_routes.go`
→ 294 (GET 149, POST 123, PUT 20, DELETE 1, PATCH 1).

Built a per-method path trie and enumerated **every (method, position) node that
has a param child**, asserting a single param name per node (gin v1.10.0 panics on
two different param names at the same position, and on param⊕wildcard at the same
position). Static + one param at the same level is allowed by gin v1.10 and is NOT
flagged.

- **(a) Two different param names at same (method, position): NONE.** Every param
  position resolves to exactly one param name. Full enumeration (78 param-bearing
  positions) all show `params=[<single>]`.
- **(b) Static + single param coexistence:** present and OK (e.g.
  `GET /chat/threads` + `GET /chat/:threadId`; `GET /lab-results/inbox` +
  `GET /lab-results/:resultId`; `GET /records/{dashboard,shares}` +
  `GET /records/:patientId`; `GET /referrals/incoming` + `GET /referrals/:id`).
  Gin v1.10 handles all of these.
- **(c) Param ⊕ wildcard at same position: NONE.**
- **(d) Exact duplicate method+path: NONE.**
- **Nested param-under-param positions: NONE** (no deep `:a/.../:b` fork could
  introduce a hidden conflict).

**Re-verification of the 3 just-fixed families (all single-name now):**

| Family | Routes | Param | File:line (finance_routes.go) |
| --- | --- | --- | --- |
| disputes | `/disputes`, `/disputes/:id`, `/disputes/:id/evidence` | `:id` | 848–851 |
| referrals/incoming | `/referrals/incoming`, `…/:id`, `…/:id/accept`, `…/:id/reject` | `:id` | 919–922 |
| follow-ups | `/follow-ups`, `…/:id`, `…/:id/review`, `…/:id/reminder`, `…/:id/complete` | `:id` | 933–937 |

Handler param reads now match: `GetSupportDispute`/`AddDisputeEvidence` read
`c.Param("id")` (`handler_account.go`); `GetIncomingReferral`,
`AcceptIncomingReferral`, `RejectIncomingReferral`, `GetFollowUp`,
`ReviewFollowUp`, `SetFollowUpReminder`, `CompleteFollowUp` all read
`c.Param("id")` (`handler_clinical.go`). No stale
`c.Param("disputeId"|"referralId"|"followUpId")` reads remain.

**Cross-wave scan (pharmacy, lab-results, lab-orders, appointments, calls, chat,
vet/pets, hmo, records, care-plans, opinions, care-team, support, security,
reviews):** each uses one param name per position —
`/appointments/:appointmentId`, `/calls/:appointmentId`,
`/lab-orders/:orderId`, `/lab-results/:resultId`, `/pharmacy/:fulfilmentId`,
`/pharmacies/:pharmacyId`, `/pharmacy/fulfilments/:id`, `/records/:patientId`,
`/care-plans/:id`, `/care-team/:threadId`, `/opinions/:id`, `/support/:threadId`,
`/security/devices/:deviceId`, `/reviews/:reviewId`, `/chat/:threadId`,
`/chat/messages/:messageId`, `/vet/pets/:petId`, `/hmo/{claims,pre-auth}/:id`,
`/hmo/coverage/:patientId`, `/hmo/support/:threadId`. No collisions.

---

## 3. Compile-shape

**PASS.**
- All **287** distinct `doctorHandler.X` references in finance_routes.go resolve
  to defined `func (h *Handler) X` methods (294 defined; superset). 0 unresolved.
- All **4** `doctorAIHandler.X` references (`GenerateNoteSummary`,
  `AcceptNoteSummary`, `CheckPrescriptionSafety`, `ExplainLabResult`) resolve to
  `func (h *AIHandler)` methods in `handler_ai.go`. 0 unresolved. The 3 AI GET
  reads (`/ai/note-summary/:appointmentId`, `/ai/rx-safety/:id`,
  `/ai/lab-explanation/:resultId`) route to `doctorHandler.GetStored*` (plain
  Handler) — all defined.
- `NewAIHandler(base *Handler, aiSvc *AIService)` matches the call site
  `doctor.NewAIHandler(doctorHandler, doctor.NewAIService(...).WithRateLimits(...))`
  (finance_routes.go:784). `WithRateLimits(perMin, perDay int) *AIService` matches
  `cfg.DoctorAIRatePerMin, cfg.DoctorAIRatePerDay`.
- The 6 edited `c.Param("id")` reads all match their now-`:id` routes (§2).
- `routes_remaining.go` is emptied to `package doctor` + comment; the removed
  symbols `RegisterRemaining` / `stubNotImplemented` have **zero call sites**
  (the only remaining occurrences are in that file's own comment).
- Receiver helpers (`userID`, `fail`, `failAI`, `idemKey`, `rawBody`) are reused
  by embedding `*Handler`; not redeclared.
- Imports in the changed files are all used (`service_ai.go`: log/fmt/time/errors/json
  all referenced; `service_vet.go`: fmt/time/platformRedis all referenced).
- Brace balance: all non-test doctor files balanced. (`handler_test.go` shows a
  1-brace skew, but it is a `{` inside the string literal
  `bytes.NewBufferString("{")` — benign, test file, out of Wave-7 scope.)

---

## 4. Dup-symbol sweep (receiver-aware)

**PASS — empty.** No duplicate `func`/method signatures across the whole package
(receiver-qualified). No duplicate top-level type/var/const names (the only
`uniq -d` hit is the literal `const (` block-opener token, not a real duplicate).
No duplicate route method+path across all 294 (§2d).

---

## 5. New-endpoint correctness (12 spot-checks of the 67)

**PASS.** Checked: `CreateBankAccount`, `ListPayouts`, `GetPayout`,
`DisputePayout`, `UpdatePayoutAccount`, `RequestPrivacyExport`,
`RequestPrivacyDelete`, `ChangePassword`, `UploadProfileDocument`,
`RecordPetGrowth` (vet), `StartAppointment`/`EndAppointment` family,
`CreateEmergencyCase`.

- **User scoping:** every handler derives `uid` from `h.userID(c)` and passes it
  to the service; every tail repo query is `WHERE … user_id = $n` (defence in
  depth on top of RLS). No unscoped queries found.
- **Idempotency on mutations:** money/record writers require `Idempotency-Key`
  (`ErrIdempotencyRequired` when empty) and use
  `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` + replay re-select
  (`repository_account_tail.go:34,296,469`; `repository_clinical_tail.go:134,312,343`).
  Example `UpsertBankAccount`: `RowsAffected()==0 → getBankAccountByIdem(user,idem)`.
- **SQL columns vs migration:** all 23 `doctor_*` tables referenced by the tail
  repos exist in `supabase/migrations/20260625000000_doctor_module.sql` (0
  missing). `doctor_bank_accounts` column list (incl. UNIQUE `idempotency_key`)
  matches the INSERT exactly.
- **Money never posts to ledger:** the tail money endpoints are request/read rows
  only; `ledger_ref` is SELECTed as a reference, never an INSERT into
  `ledger_entries`. Repos explicitly document "None post ledger entries."
- **account_number masked:** `maskAccountNumber` returns `"******"+last4`
  (`service_account_tail.go:159-170`); applied on create and read.

---

## 6. LLM rate guard — VERDICT: PASS

`service_ai.go` `guardRate(ctx, userID)`:
- Fixed-window per-doctor on Redis keys `ai:rl:<uid>:m:<unixMin>` (TTL 70s) and
  `ai:rl:<uid>:d:<unixDay>` (TTL 26h), using go-redis v9 native
  `rc.Incr(ctx,key).Result()` then `rc.Expire(ctx,key,ttl).Err()` on the first hit
  (`n==1`). `a.svc.redis` is `*goredis.Client` — both methods exist on it.
- Over-limit (`n > limit`) → `ErrAIRateLimited`; handler `failAI` maps it to
  **HTTP 429** (`handler_ai.go:12-16`). All 3 generate handlers call `h.failAI`;
  `AcceptNoteSummary` (no LLM call) correctly uses `h.fail`.
- **Fail-OPEN** on nil redis (logs + returns nil) and on INCR error (logs +
  returns nil). A limiter outage never blocks clinical AI.
- Called **before every** `gen.GenerateJSON` in `GenerateNoteSummary`,
  `CheckPrescriptionSafety`, `ExplainLabResult` (the LLM is never invoked once
  over limit). `WithRateLimits(0,…)` disables a window.
- **Config defaults present:** `config.go:222-223`
  `DoctorAIRatePerMin = getEnvInt("DOCTOR_AI_RATE_PER_MIN", 20)`,
  `DoctorAIRatePerDay = getEnvInt("DOCTOR_AI_RATE_PER_DAY", 200)`; service
  fallback constants `aiRateDefaultPerMin=20`/`aiRateDefaultPerDay=200`.

---

## 7. Pet-growth idempotency — VERDICT: PASS

`service_vet.go` `RecordPetGrowth` (lines 236-258):
- Requires `Idempotency-Key` (`ErrIdempotencyRequired`).
- **SetNX claim BEFORE append:**
  `platformRedis.SetNX(ctx, s.redis, "doctor:pet-growth:<uid>:<petID>:<idem>", "1", 24h)`.
- **Replay** (`err==nil && !ok`) returns `s.repo.GetPet(ctx,userID,petID)` — the
  prior pet state, with **no second append**.
- **Fail-open** on nil redis (whole block skipped) and on SetNX error (proceeds
  to append). `GetPet` and `AppendPetGrowth` both scope `WHERE id=$1 AND user_id=$2`.

---

## 8. Coverage-doc accuracy — VERDICT: FAIL (MAJOR)

`docs/DOCTOR_ENDPOINT_COVERAGE.md` claims: **235** OpenAPI ops, **294** wired,
**0** missing, **59** extras.

Independent recount against the **current** `contracts/doctor.openapi.yaml`,
using the doc's own stated normalization (strip `/doctor` prefix; replace every
`{name}`/`:name` segment with `*`):

| Metric | Doc claims | Independent recount |
| --- | ---: | ---: |
| OpenAPI unique method+path ops | 235 | **315** |
| Routes wired | 294 | 294 (matches) |
| Contract ops with NO wired route (missing) | 0 | **26** |
| Wired routes not in contract (extras) | 59 | **5** |

The wired count (294) is correct, but the contract baseline is stale: the spec
now has **315** operations, not 235 (an ~80-op gap), so **coverage is not
complete**. Confirmed genuinely-unwired contract operations include:
`GET /dashboard`, `GET /wallet/balance`, `GET /schedule`, `GET /calls/disputes`,
`GET /payouts/disputes`, `GET /emergency/cases` (only `POST` is wired),
`GET /vet/verification` (only `POST` is wired), `GET /earnings/{breakdown,commission,tax-vat}`,
`GET /account/{status,review-notice}`, `GET /invoices`, `GET /red-flag-alerts`,
`GET /support/{faqs,help-articles}`, `GET /onboarding/slides`,
`GET /announcements/latest`, `GET /verification/decision`, `GET /app-status`,
`GET /analytics/quality`, `GET /vet/licence`, `GET /vet/profile/{draft,documents}`,
`GET /emergency/{escalations,facilities}`,
`GET /pharmacy/fulfilments/:id/delivery` (param-shape variant).

**Impact:** documentation/coverage-tracking only. No code, compile, or router
impact. Recommend either (a) regenerate the doc against the current spec and wire
the 26 missing ops in a follow-up wave, or (b) if the spec grew intentionally
beyond this wave's scope, re-baseline the doc and explicitly list the 26 as
known-open. **This is a MAJOR finding because the doc currently asserts "full
contract coverage / 0 missing," which is false.**

---

## 9. Security — VERDICT: PASS

- **AI/RTC secrets server-side only.** `service_ops.go:37` — "Secrets (App
  Certificate / VideoSDK secret) never leave the Issuer." `issueCallToken` returns
  an empty token + `rtcConfigured=false` when the Issuer is nil rather than
  fabricating one. `AiModelLabel` is an explicit non-secret display label. No
  `secret`/`apiKey`/`api_key` literals are returned to clients.
- **security/change-password stores NO password.** `ChangePassword` handler reads
  no password from the body; the service only writes an audit row
  (`security.password_change_requested`) — "Passwords live in Supabase Auth —
  nothing here stores or verifies a password."
- **privacy export/delete are requests, not direct deletes.**
  `RequestPrivacyExport`/`RequestPrivacyDelete` write request rows
  (`doctor_data_privacy_settings`); no `DELETE FROM`/`DROP` exists anywhere in the
  `*_tail.go` files.

---

## 10. Additive scope — PASS

Touched files are confined to: `backend/internal/doctor/*` (incl. the 9 `*_tail.go`
and the emptied `routes_remaining.go`), `backend/internal/app/finance_routes.go`,
`backend/internal/config/config.go`, and the new doc. No migration change (the
referenced `20260625000000_doctor_module.sql` already contains every table/column
used). No `go.mod` dependency added (rate guard reuses existing go-redis v9;
pet-growth reuses existing `platform/redis.SetNX`).

---

## 11. Defect list (describe — not applied)

1. **[MAJOR] Coverage doc numbers are inaccurate vs current spec.**
   `docs/DOCTOR_ENDPOINT_COVERAGE.md` lines 13-16 / 22 claim 235 ops & 0 missing;
   actual spec has 315 ops with 26 unwired (§8). No code impact. Fix: re-baseline
   doc and/or wire the 26 ops in a follow-up.

2. **[MINOR] `handler_test.go` brace skew is cosmetic only** — a `{` inside the
   string `bytes.NewBufferString("{")` (line 156). Not a compile issue; noted only
   because a naive brace-count scan flags it. No action required.

No BLOCKERs: zero router-panic conflicts, zero unresolved/duplicate symbols.

---

## Run in CI (required — no Go toolchain here)

```
cd backend && go build ./... \
  && go vet ./internal/doctor/... ./internal/integrations/... \
  && go test ./internal/doctor/...
```

**No-toolchain caveat:** this review is static-only. Type inference, interface
satisfaction (e.g. `*llm.Client` implementing `aiGenerator`), exhaustive unused-
import detection, and test execution were NOT machine-verified. The CI command
above must be green before merge.
