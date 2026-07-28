# QA Report — Doctor Backend, WAVE 2 (account / provider / admin + payout audit hardening)

**Reviewer:** QA/Go static reviewer
**Date:** 2026-06-21
**Method:** STATIC review only. **No Go toolchain in the sandbox** — `go build`, `go vet`, `go test` were NOT run. Compile-shape checks were done by hand (signature matching, struct/column matching, route↔handler matching). Treat the "run in CI" section as the authoritative final gate.

---

## 1. Summary verdict

**Overall: PASS (ship-ready pending CI compile + the two minor OpenAPI status-code nits).**

The Wave 2 slice is clean, consistent with the MVP pattern, correctly user-scoped, and idempotency-correct where it matters. The payout audit-durability hardening is **correct (PASS)**. No data-leak, no float money, no stored-balance, no destructive migration. I found **no signature mismatches, no struct↔column mismatches, and no route↔handler mismatches** — the real-bug categories are clean.

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 0 |
| Minor | 4 |

Minor items are: (M1) DisputeReview/ReportReview return 201 vs OpenAPI 200; (M2) AcceptConsent/RecordPermission return 201 vs OpenAPI 200; (M3) idempotency-key on three reused-write paths is *required by the service* but the underlying table has no idempotency_key column (intentional but worth documenting); (M4) `rawBody` patch endpoints accept arbitrary JSON with no shape validation (by design — `Generic` schema — noted, not a defect).

---

## 2. Route coverage (Wave 2 groups)

Routes added in the `if cfg.FeatureDoctorEnabled` block of `backend/internal/app/finance_routes.go:698-756`. Every route resolves to a handler that exists in `handler_account.go` (or `handler.go` for `GetSettings`/`MarkNotificationRead` reused). No duplicate method+path vs the MVP routes (`finance_routes.go:667-694`).

| Method | Path (under /api/v1/doctor) | Handler | In OpenAPI? |
|---|---|---|---|
| GET  | /onboarding/consents | ListConsents | ✅ `/doctor/onboarding/consents` |
| POST | /onboarding/consents | AcceptConsent | ✅ (OpenAPI says 200; impl 201 — M2) |
| GET  | /onboarding/permissions | ListPermissions | ✅ |
| POST | /onboarding/permissions | RecordPermission | ✅ (200 vs 201 — M2) |
| GET  | /onboarding/merchant-upgrade | GetMerchantUpgrade | ✅ |
| POST | /onboarding/merchant-upgrade | RequestMerchantUpgrade | ✅ |
| POST | /onboarding/provider-type | SetProviderType | ✅ |
| GET  | /profile/draft | GetProfileDraft | ✅ |
| PUT  | /profile/draft | SaveProfileDraft | ✅ |
| GET  | /profile/documents | ListProfileDocuments | ✅ |
| POST | /profile/publish | PublishProfile | ✅ |
| GET  | /licence/expiry-warning | GetLicenceExpiry | ✅ |
| POST | /licence/renew | RenewLicence | ✅ |
| GET  | /notifications/groups | ListNotificationGroups | ✅ |
| GET  | /notifications/preferences | ListNotificationPreferences | ✅ |
| PUT  | /notifications/preferences | UpdateNotificationPreference | ✅ |
| POST | /notifications/read-all | MarkAllNotificationsRead | ✅ |
| GET  | /support/tickets | ListSupportTickets | ✅ |
| POST | /support/tickets | CreateSupportTicket | ✅ |
| GET  | /disputes | ListSupportDisputes | ✅ |
| POST | /disputes | CreateSupportDispute | ✅ |
| GET  | /disputes/:id | GetSupportDispute | ✅ |
| POST | /disputes/:disputeId/evidence | AddDisputeEvidence | ✅ |
| GET  | /support/:threadId/messages | ListSupportMessages | ✅ |
| POST | /support/:threadId/messages | SendSupportMessage | ✅ |
| GET  | /audit-trail | ListAuditTrail | ✅ |
| GET  | /training | ListTraining | ✅ |
| POST | /training/:moduleId/complete | CompleteTraining | ✅ |
| GET  | /safety-issues | ListSafetyIssues | ✅ |
| POST | /safety-issues | ReportSafetyIssue | ✅ |
| GET  | /privacy | GetPrivacySettings | ✅ |
| PUT  | /privacy | UpdatePrivacySettings | ✅ |
| GET  | /security | GetSecurity | ✅ |
| PUT  | /security/biometric | SetSecurityFlags | ✅ |
| PUT  | /security/2fa | SetSecurityFlags | ✅ |
| GET  | /security/devices | ListDevices | ✅ |
| DELETE | /security/devices/:deviceId | RevokeDevice | ✅ |
| GET  | /preferences | GetAppPreferences | ✅ |
| PUT  | /preferences | UpdateAppPreferences | ✅ |
| GET  | /quality/score | GetQualityScore | ✅ |
| GET  | /quality/ranking | GetRanking | ✅ |
| GET  | /quality/recommendations | GetImprovements | ✅ |
| GET  | /feedback | ListConsultationFeedback | ✅ |
| GET  | /reviews/disputes | ListReviewDisputes | ✅ |
| POST | /reviews/:reviewId/dispute | DisputeReview | ✅ (OpenAPI 201 — matches) |
| POST | /reviews/:reviewId/report | ReportReview | ✅ (OpenAPI says 200; impl 201 — M1) |
| POST | /reviews/:reviewId/removal-request | ReportReview | ✅ (OpenAPI says 200; impl 201 — M1) |

**Every Wave 2 route's path is present in `contracts/doctor.openapi.yaml`.** No spurious paths.

### Coverage gaps in the Wave 2 groups
None that are failures. The OpenAPI has a handful of account/provider sub-paths the implementer chose not to wire (each is a known TODO, not a Wave-2 deliverable):
- `/doctor/profile/photo`, `/doctor/profile/bank-account`, `/doctor/profile/tax-info` (profile builder extras)
- `/doctor/onboarding/slides`, `/doctor/onboarding/legal` (static content)
- `/doctor/privacy/export`, `/doctor/privacy/delete` (DSAR actions)
- `/doctor/security/password` (password change)
- `/doctor/support/faqs`, `/doctor/support/help-articles`, `/doctor/support/technical` (static/help)
- `/doctor/notifications/{notificationId}/read` (single-mark — already covered by MVP `/notifications/:id/read`)

These are NOTES, not defects — they're either static content or explicitly out of the seven Wave-2 functional groups.

### Deferred (intentional — clinical/money beyond MVP)
Per scope, NOT counted as gaps: pharmacy fulfilments/substitutes/refills, labs extended, referrals/second-opinions/care-team, follow-ups, HMO coverage/preauth/claims/disputes/support, vet mode (`/doctor/vet/*`), AI rx-safety, payouts beyond MVP (`/doctor/payouts/disputes`), call sessions/disputes, records hub. These map to the `routes_remaining.go` stubs and the batch1–5 / phase2 / vet tags.

---

## 3. Per-check findings

### Check 1 — COMPILE-SHAPE  →  PASS
Hand-verified every `h.svc.X(...)` in `handler_account.go` against the signature in `service_account.go`:
- All param counts/types and return arity match. Spot examples:
  - `handler_account.go:55` `h.svc.AcceptConsent(ctx, uid, req)` ↔ `service_account.go:27` `AcceptConsent(ctx, userID string, req AcceptConsentRequest) (*LegalConsent, error)` ✅
  - `handler_account.go:116` `h.svc.RequestMerchantUpgrade(ctx, uid, h.idemKey(c), detail)` ↔ `service_account.go:43` `RequestMerchantUpgrade(ctx, userID, idemKey string, detail json.RawMessage)` (handler passes `json.RawMessage` from `rawBody`) ✅
  - `handler_account.go:377` `h.svc.AddDisputeEvidence(ctx, uid, c.Param("disputeId"), h.idemKey(c), req)` ↔ `service_account.go:149` `(ctx, userID, disputeID, idemKey string, req AddEvidenceRequest)` ✅
  - `handler_account.go:542` `h.svc.RevokeDevice(...)` returns only `error`; handler treats it as such ✅
  - `handler_account.go:640/655` use `res.Ranking` / `res.Recommendations` — both exist on `QualityScore` (`model_account.go:254-255`) ✅
- Request structs bound via `ShouldBindJSON` all exist in `model_account.go`: `AcceptConsentRequest`, `RecordPermissionRequest`, `SetProviderTypeRequest`, `UpdateNotificationPreferenceRequest`, `CreateSupportTicketRequest`, `CreateDisputeRequest`, `AddEvidenceRequest`, `SendSupportMessageRequest`, `ReportSafetyIssueRequest`, `ReviewActionRequest`. `SubmitVerificationRequest` (RenewLicence) and `UpdateSettingsRequest` (SetSecurityFlags) come from `model.go`. ✅
- Reused helpers `h.userID` / `h.fail` / `h.idemKey` are defined ONCE in `handler.go:21,32,47` and are NOT redefined in `handler_account.go`. The only new helper is `h.rawBody` (`handler_account.go:21`), unique. ✅
- No duplicate method names across `handler.go` + `handler_account.go` (checked all 47+ method names; `GetSettings`/`MarkNotificationRead` live only in `handler.go` and are reused by routes, not redefined). ✅
- Imports: `handler_account.go` imports `encoding/json`, `net/http`, `gin` — all used (`json.RawMessage` in `rawBody`, `http.Status*`, `gin.Context`/`gin.H`). `service_account.go` imports `context`, `encoding/json`, `errors` — all used. `repository_account.go` imports `context`, `errors`, `time`, `uuid`, `pgx` — all used. ✅
- Repo helpers `boolOrDefault` (`repository.go:889`), `jsonOrEmptyObject` (`:850`), `jsonOrEmptyArray` (`:843`) exist and are reused, not redefined. ✅

> Caveat: this is a hand check. Final confirmation requires `go build ./...`.

### Check 2 — ROUTE WIRING  →  PASS
See coverage table §2. Every Wave 2 route points to an existing handler; no method+path duplicates the MVP routes; every path is in the OpenAPI. The two non-MVP handlers serving two routes each (`SetSecurityFlags` for biometric+2fa; `ReportReview` for report+removal-request) are intentional and documented in code comments (`handler_account.go:562-564,702-703`).

### Check 3 — AUTH + SCOPING  →  PASS
Every Wave 2 handler resolves the doctor via `h.userID(c)` and passes `uid` to the service as the first business arg; the service forwards it to the repo. Eight representative repo WHERE clauses (all scoped by `user_id`, or by `id` AND `user_id` for single-row fetches):

1. `ListConsents` `repository_account.go:23` — `WHERE user_id = $1`
2. `GetMerchantUpgrade` `:120` — `WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`
3. `GetSupportDispute` `:429` — `WHERE id = $1 AND user_id = $2`
4. `AppendDisputeEvidence` (write) `:474` — `UPDATE ... WHERE id = $1 AND user_id = $2`
5. `ListSupportMessages` `:490` — `WHERE user_id = $1 AND thread_id = $2`
6. `RevokeDevice` (write) `:753` — `UPDATE ... WHERE id = $1 AND user_id = $2`
7. `CompleteTraining` (write) sel `:614` — `WHERE user_id = $1 AND module_id = $2`
8. `MarkReviewReported` (write) `:843` — `UPDATE doctor_reviews ... WHERE id = $1 AND user_id = $2`

**No unscoped read or write found.** `SaveProfileDraft`/`PublishProfile`/`UpdatePrivacySettings`/`GetSettings`/`UpsertSettings` also all key on `user_id`. This is defence-in-depth on top of RLS.

### Check 4 — IDEMPOTENCY  →  PASS (with documented exceptions)
Every service mutation reads `Idempotency-Key`. For tables carrying a UNIQUE `idempotency_key` column, the repo does `ON CONFLICT (idempotency_key) DO NOTHING` + replay-by-idem (mirrors MVP `InsertPrescription`). For tables WITHOUT that column, the write is a deterministic UPSERT keyed on a natural unique key (so replay is naturally safe), or a JSONB merge / flag flip that is itself idempotent.

| Mutation | Table | idempotency_key col? | Mechanism |
|---|---|---|---|
| AcceptConsent | doctor_legal_consents | No | ON CONFLICT (user_id,consent_kind,version) upsert — naturally idempotent ✅ |
| RecordPermission | doctor_app_permissions | No | ON CONFLICT (user_id,permission_kind) upsert ✅ |
| RequestMerchantUpgrade | doctor_merchant_upgrades | **Yes** | ON CONFLICT (idempotency_key) DO NOTHING + replay ✅ |
| SetProviderType / SaveProfileDraft | doctor_profiles | No | idempotent JSONB merge `profile_draft \|\| patch` ✅ |
| PublishProfile | doctor_profiles | No | idempotent flag set `is_published=true` ✅ |
| RenewLicence | doctor_verifications | No | INSERT (see M3) ⚠️ |
| UpdateNotificationPreference | doctor_notification_preferences | No | ON CONFLICT (user_id,channel,category) upsert ✅ |
| CreateSupportTicket | doctor_support_tickets | **Yes** | ON CONFLICT (idempotency_key) + replay ✅ |
| CreateSupportDispute | doctor_support_disputes | **Yes** | ON CONFLICT (idempotency_key) + replay ✅ |
| AddDisputeEvidence | doctor_support_disputes | n/a | JSONB array append (see M3) ⚠️ |
| SendSupportMessage | doctor_support_messages | **Yes** | ON CONFLICT (idempotency_key) + replay ✅ |
| CompleteTraining | doctor_mandatory_training | Yes + (user_id,module_id) | ON CONFLICT (user_id,module_id) upsert — idempotent ✅ |
| ReportSafetyIssue | doctor_safety_issues | **Yes** | ON CONFLICT (idempotency_key) + replay ✅ |
| UpdatePrivacySettings | doctor_data_privacy_settings | No | idempotent JSONB merge ✅ |
| RevokeDevice | doctor_devices | No | idempotent flag set ✅ |
| SetSecurityFlags / UpdateAppPreferences | doctor_settings | No | idempotent UPSERT (partial) ✅ |
| DisputeReview / ReportReview | doctor_review_disputes | **Yes** | ON CONFLICT (idempotency_key) + replay ✅ |

> M3 detail: `RenewLicence` and `AddDisputeEvidence` *require* the header (service returns `ErrIdempotencyRequired` if absent) but the persistence is **not** key-deduped — a retried `RenewLicence` inserts a second `doctor_verifications` row, and a retried `AddDisputeEvidence` appends the evidence array twice. Low risk (non-money, append-style), but the idempotency guarantee is weaker than the header contract implies. Recommend either (a) drop the header requirement for these two, or (b) add idempotency_key dedupe. **Minor.**

### Check 5 — AUDIT HARDENING CORRECTNESS  →  **PASS** (see §4 for full verdict)

### Check 6 — STRUCT↔COLUMN MATCH  →  PASS
Verified repo column lists against the migration DDL for 6+ Wave 2 tables. All match exactly (column name, presence, scan order vs SELECT order):

1. **doctor_legal_consents** (migration `:113`) cols `id,user_id,consent_kind,version,accepted,accepted_at,created_at` ↔ repo SELECT `repository_account.go:22` and Scan `:32-33` — match ✅
2. **doctor_app_permissions** (`:125`) `id,user_id,permission_kind,state,decided_at,created_at,updated_at` ↔ repo `:75` / `:85` — match ✅
3. **doctor_support_tickets** (`:1128`) `id,user_id,ref,subject,category,status,last_reply,idempotency_key,created_at,updated_at` ↔ repo read `:340` / insert `:364` — match ✅
4. **doctor_support_disputes** (`:1143`) `id,user_id,status,subject,evidence,detail,idempotency_key,created_at,updated_at` ↔ repo `:407` / `:443` — match ✅
5. **doctor_devices** (`:1224`) `id,user_id,device_label,platform,last_seen_at,revoked,revoked_at,detail,created_at` ↔ repo `:730` / `:752` — match ✅
6. **doctor_mandatory_training** (`:1184`) `id,user_id,module_id,title,status,completed_at,detail,idempotency_key,created_at,updated_at` ↔ repo `:581` / `:605` — match ✅ (insert uses both UNIQUE(idempotency_key) and UNIQUE(user_id,module_id); ON CONFLICT targets the latter)
7. Bonus — **doctor_quality_scores** (`:978`) `score numeric(6,2)`, `ranking jsonb`, `recommendations jsonb` ↔ `QualityScore.Score float64`, `.Ranking/.Recommendations json.RawMessage` — match ✅
8. Bonus — **doctor_compliance_audit** (`:1170`) `user_id,action,entity_type,entity_id,detail,idempotency_key` ↔ both `InsertAudit` and the new `InsertPayoutWithAudit` insert exactly those columns — match ✅

**No struct↔column mismatches found.**

### Check 7 — ADDITIVE SCOPE  →  PASS
`git status` (scoped) shows: doctor module dir is entirely **untracked/new**, the migration file is **new**, and `backend/internal/app/finance_routes.go` is the only modified tracked file in scope (the Wave 2 route block was appended inside the existing `FeatureDoctorEnabled` guard). `service.go`/`repository.go` are part of the new untracked module (the "edit" is to files added in the MVP wave, same package). No other module touched by this wave. Migration is **additive-only** — grep for `DROP` / `ALTER ... DROP` / `RENAME` returned nothing; all tables are `CREATE TABLE IF NOT EXISTS`.

### Check 8 — MONEY RULES  →  PASS
- No floats in money paths. `amount_kobo` is `int64` in Go (`Payout.AmountKobo`, `RequestPayoutResult`) and `bigint CHECK (amount_kobo > 0)` in the migration. Wave 2 introduces no new money fields.
- `QualityScore.Score float64` maps `numeric(6,2)` — this is a quality *rating*, not money. Acceptable.
- No stored-balance column introduced. `doctor_payouts` records request + `ledger_ref` only; balance stays a ledger projection (`service.go:101-112` `GetEarnings`).

### Check 9 — OPENAPI CONFORMANCE NITS
- **M1 (confirmed):** `ReportReview` returns **201** (`handler_account.go:719`) but OpenAPI says **200** for both `/reviews/{reviewId}/report` (`doctor.openapi.yaml:930`) and `/reviews/{reviewId}/removal-request` (`:2149`). `DisputeReview` returns 201 and `/reviews/{reviewId}/dispute` *does* spec 201 (`:2139`) — so DisputeReview is actually correct; only the report/removal-request status is off.
- **M2 (new):** `AcceptConsent` (`handler_account.go:60`) and `RecordPermission` (`:91`) return **201**, but OpenAPI specs **200** for `POST /onboarding/consents` (`:1154`) and `/onboarding/permissions` (`:1162`). Minor.
- Other Wave 2 POSTs that return 201 (merchant-upgrade, support tickets, disputes, safety-issues, licence/renew) — OpenAPI types these bodies as the free-form `Generic` and most responses are loosely specified; 201 on a create is defensible. No blocker. Recommend the team decide one convention (200 vs 201 for idempotent creates) and align spec+impl.

---

## 4. Audit-hardening verdict — **PASS**

Path: `service.go:168-223` (`RequestPayout`) → `repository.go:793-830` (`InsertPayoutWithAudit`).

- **Single transaction:** `InsertPayoutWithAudit` opens one pgx tx (`repository.go:798` `r.db.Begin`), `defer tx.Rollback(ctx)` (`:802`), inserts the payout row (`:808`) and the audit row (`:820`) on the **same tx**, then `tx.Commit` (`:824`). ✅
- **Audit failure rolls back the payout:** if `insAudit` Exec errors (`:820-822`) the function returns before Commit; the deferred `Rollback` undoes the payout INSERT. **No orphaned payout-without-audit is possible.** ✅ This is a genuine improvement over the prior best-effort `_ = InsertAudit(...)` that swallowed audit failures (documented in the service comment `service.go:211-219`).
- **Ledger ordering soundness:** `ledger.Debit` (`service.go:206`) commits its own atomic double-entry BEFORE the payout-row+audit tx. There IS a window: if the process dies (or the row+audit tx fails) **after** the ledger debit committed, you get a posted ledger debit with **no** `doctor_payouts` request row and **no** audit row. This is a recognised pattern, and it is **safe-on-retry** because:
  - The ledger `Debit` is itself idempotency-keyed on `ledgerRef`/`idemKey` (`service.go:205-206`), so a client retry with the same `Idempotency-Key` will NOT double-debit.
  - On retry, `FindPayoutByIdem` (`service.go:178`) finds no row (the row never committed), so flow proceeds; `ledger.Debit` returns its duplicate/no-op for the same key; then `InsertPayoutWithAudit` writes the row+audit. Net effect: exactly one debit, exactly one payout row, exactly one audit. ✅
  - Residual risk if the *client never retries*: a committed ledger debit with no request row. This is an operational/reconciliation concern, not a correctness regression — and it is strictly better than the previous code where the audit could silently vanish even on the happy path. A belt-and-suspenders improvement would be to post the ledger debit inside the same tx (requires the ledger service to accept an external tx), but that is **out of scope** for this hardening and not a blocker.

**Reasoning:** the stated goal — "audit insert failure must roll back the payout row, no orphaned payout without audit" — is fully met, and the idempotency key makes the one remaining ledger/row window retry-safe. **Verdict: PASS.**

---

## 5. Prioritized defect list (describe fixes — do NOT apply)

1. **M1 — ReportReview status code (OpenAPI conformance).** `handler_account.go:719` returns `http.StatusCreated`; spec wants 200 for `/reviews/{reviewId}/report` and `/reviews/{reviewId}/removal-request`. *Fix:* change to `c.JSON(http.StatusOK, res)` OR update the OpenAPI to 201 (and align removal-request). Leave `DisputeReview` at 201 (spec already says 201).
2. **M2 — Onboarding create status codes.** `AcceptConsent` (`handler_account.go:60`) and `RecordPermission` (`:91`) return 201; spec says 200. *Fix:* return 200, or update spec. Pick one create-convention project-wide.
3. **M3 — Idempotency header required but not enforced at storage for two writes.** `RenewLicence` (inserts `doctor_verifications`, no idempotency_key) and `AddDisputeEvidence` (JSONB array append) demand the header but a retry duplicates data. *Fix (option A):* drop the `if idemKey == "" { return ErrIdempotencyRequired }` for these two if duplicates are acceptable; *(option B):* add an `idempotency_key` column + ON CONFLICT to `doctor_verifications` for renewals, and dedupe evidence appends by a client-supplied evidence id. Low risk; non-money.
4. **M4 (NOTE, not a fix-required defect) — `rawBody` patch endpoints accept unvalidated JSON.** `SaveProfileDraft`, `RequestMerchantUpgrade`, `CompleteTraining`, `UpdatePrivacySettings`, `UpdateAppPreferences` take free-form `json.RawMessage` and merge into JSONB. This matches the OpenAPI `Generic` schema, but there is no max-size guard or key allow-list. *Optional hardening:* cap body size and/or validate top-level keys before the `jsonb || jsonb` merge to avoid uncontrolled JSONB growth.

---

## 6. Run in CI (authoritative gate — could not run here)

```bash
cd backend && go build ./... && go vet ./internal/doctor/... && go test ./internal/doctor/...
```

Because there is **no Go toolchain in the review sandbox**, the compile-shape and import checks above are hand-verified, not compiler-verified. The build + vet must be green before merge. (Note: `backend/tests/` is empty per CLAUDE.md, so `go test ./internal/doctor/...` will report "no test files" unless Wave 2 tests are added — the existing `service_test.go`/`handler_test.go`/`service_integration_test.go` in the package will be compiled and run.)

---

## Appendix — files reviewed
- `backend/internal/doctor/model_account.go`, `repository_account.go`, `service_account.go`, `handler_account.go` (NEW)
- `backend/internal/doctor/handler.go`, `service.go`, `repository.go`, `model.go`, `routes_remaining.go` (context + audit edit)
- `backend/internal/app/finance_routes.go:655-758` (Wave 2 route block)
- `contracts/doctor.openapi.yaml`
- `supabase/migrations/20260625000000_doctor_module.sql`
- `mobile-app/reactnative/docs/DOCTOR_ENDPOINT_INVENTORY.md` (tag inventory)
