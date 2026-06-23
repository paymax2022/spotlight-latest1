# Doctor Module — Endpoint Coverage Reconciliation

Authoritative target: `contracts/doctor.openapi.yaml`
Wired routes: `backend/internal/app/finance_routes.go` (group `/api/v1/doctor`)
Cross-reference: `mobile-app/reactnative/docs/DOCTOR_ENDPOINT_INVENTORY.md`

Generated during the finishing/hardening pass (Waves MVP–6 + tail + Wave-3 close-out).

> **Independent re-verification (2026-06-23).** Re-counted with a parser that
> handles both block (`get:`) and inline-flow (`get: {…}`) YAML, normalizing both
> sides (strip `/doctor` prefix; collapse `{name}`/`:name` → one shape):
> **316** unique contract operations, **321** wired routes (`docGroup.*` unique
> method+path), **0** contract operations missing a wired route, **5** wired
> routes with no contract counterpart (the granular `/schedule/{recurring,
> reminders,vacation}` GETs, `GET /vet/recommendations`, `POST /chronic-monitoring`
> — all listed in the extras section below).
>
> The count is +1 vs the post-close-out table (315 → 316) because this pass adds
> the backend-owned R2 presign endpoint **`POST /doctor/uploads/presign`** to both
> the contract and the wired routes (it backs the go-live uploads:
> uploadProfilePhoto / uploadDocument / renewLicence / sendAttachment /
> uploadDisputeEvidence — the client records metadata only).
>
> The earlier Wave-7 QA report (`QA_DOCTOR_BACKEND_WAVE7_REPORT.md` §8) flagged
> 235/294/0/59 — that finding was against the *pre-correction* version of this file
> and is now superseded; the 26 then-unwired GETs are wired and the contract baseline
> is the corrected 316.
>
> **Emergency dispatch:** `POST /emergency/escalate/{ambulance,hospital}` and
> `POST /emergency/contacts/{patientId}/notify` are now gated behind a dedicated
> flag `FEATURE_DOCTOR_EMERGENCY_DISPATCH_ENABLED` (default **OFF**). They are wired
> only when that flag is on; with it off they are NOT registered. They **must route
> to a vetted emergency-services provider** before any real go-live (separate safety
> review). Case CRUD (`GET /emergency/cases/:id`, `POST /emergency/cases`) is
> unaffected. The route-count figures above are taken with the dispatch flag on
> (all routes present); with the flag off the wired count is 318.

> **Recount correction (this pass).** The earlier counts in this file understated
> the contract size: the OpenAPI parser they were generated with only matched
> operations written as `get:` on their own line and silently skipped the many
> operations declared in inline-flow style (`get: { tags: … }`). The true
> contract total is **315** unique operations, not 235. With the corrected
> baseline, 26 contract GETs were genuinely unwired before this pass — they are
> wired here. All numbers below are recounted with a parser that handles both
> block and inline-flow YAML.

## Summary

| Metric | Before close-out | After close-out |
| --- | ---: | ---: |
| OpenAPI operations (unique method+path) | 315 | 315 |
| Routes wired under `/api/v1/doctor` | 294 | **320** |
| Contract operations with NO matching wired route | **26** | **0** |
| Routes wired but NOT in the contract | 5 | 5 |

Path-parameter name differences are treated as matches (e.g. contract
`{fulfilmentId}` ≡ route `:id`). The diff normalizes both sides by stripping the
`/doctor` prefix and collapsing every `{name}` / `:name` segment to one shape.

**Result: full contract coverage — 0 missing. Wired-not-in-contract extras = 5.**

### Reproduce the counts

```
# Wired routes (unique method + normalized path)
grep -oE 'docGroup\.(GET|POST|PUT|DELETE|PATCH)\("[^"]+"' \
  backend/internal/app/finance_routes.go | sort -u   # → 320

# Contract ops: parse method+path from contracts/doctor.openapi.yaml `paths:`,
# matching BOTH `get:` (block) and `get: { … }` (inline-flow) → 315 unique ops.
# DIFF(contract, wired) → 0 missing ; DIFF(wired, contract) → 5 extras.
```

## Wave-3 close-out — endpoints wired in this pass (26, all GET)

All 26 are read-only and scoped to the authenticated doctor.
Files: `handler_tail2.go`, `service_tail2.go`, `repository_tail2.go`, `model_tail2.go`.
Money reads (`/wallet/balance`, `/earnings/*`) are **ledger-projected** — they read
no stored balance and post no ledger entries. The wallet balance reuses the exact
ledger call the MVP earnings path uses (`Service.ledger.GetBalance`, see
`service.go:115`; mirrored in `service_tail2.go:GetWalletBalance`).

| Method | Path | Handler | Source / projection |
| --- | --- | --- | --- |
| GET | /dashboard | GetDashboard | composed: appt counts + unread notifs + ledger balance |
| GET | /wallet/balance | GetWalletBalance | **ledger projection** (`ledger.GetBalance`) |
| GET | /earnings/breakdown | GetEarningsBreakdown | ledger balance + `doctor_invoices` sums |
| GET | /earnings/commission | GetCommissionBreakdown | `doctor_commission_config` + invoice sums |
| GET | /earnings/tax-vat | GetTaxVatReport | `doctor_invoices` VAT/gross/net sums |
| GET | /invoices | ListInvoices | `doctor_invoices` |
| GET | /payouts/disputes | ListSettlementDisputes | `doctor_settlement_disputes` |
| GET | /calls/disputes | ListCallDisputes | `doctor_call_disputes` |
| GET | /emergency/cases | ListEmergencyCases | `doctor_emergency_cases` |
| GET | /emergency/escalations | ListEmergencyEscalations | `doctor_emergency_escalations` |
| GET | /emergency/facilities | ListEmergencyFacilities | `doctor_emergency_facilities` |
| GET | /red-flag-alerts | ListRedFlagAlerts | derived from `doctor_emergency_escalations` (hospital/ambulance) |
| GET | /schedule | GetScheduleSettings | composed: blocked-dates + recurring + reminders + vacation |
| GET | /analytics/quality | GetQualityAnalytics | `doctor_quality_scores` (latest; zeroed if none) |
| GET | /account/status | GetAccountStatus | derived from profile + latest verification |
| GET | /account/review-notice | GetReviewNotice | derived from latest verification |
| GET | /verification/decision | GetVerificationDecision | `doctor_verifications` (latest) |
| GET | /app-status | GetAppStatus | static server-side runtime status (no table) |
| GET | /announcements/latest | GetLatestAnnouncement | derived empty projection (no doctor announcement table) |
| GET | /support/faqs | GetSupportFAQs | static FAQ catalogue (no table) |
| GET | /support/help-articles | GetHelpArticles | static help-article catalogue (no table) |
| GET | /onboarding/slides | GetOnboardingSlides | static onboarding deck (no table) |
| GET | /vet/licence | GetVetLicence | `doctor_vet_profiles` |
| GET | /vet/verification | GetVetVerification | `doctor_vet_profiles` |
| GET | /vet/profile/draft | GetVetProfileDraft | `doctor_vet_profiles` (profile_draft) |
| GET | /vet/profile/documents | ListVetProfileDocuments | `doctor_verification_documents` (vet doc_types) |

Static-segment routes (`/calls/disputes`, `/payouts/disputes`, `/support/faqs`,
`/support/help-articles`, `/emergency/cases`) coexist with their sibling `:param`
routes — gin v1.10 allows a static child and a wildcard child on the same parent
(static wins), the same pattern already used by `/pharmacies/preferred` vs
`/pharmacies/:pharmacyId/stock`. No duplicate routes; no param-name conflicts.

Two derived projections lean on absent dedicated tables and return a stable empty
shape (documented inline, **no migration added**): `/announcements/latest`
(no doctor announcement table → `{ "announcement": null }`) and
`/app-status` / `/support/faqs` / `/support/help-articles` / `/onboarding/slides`
(static server-side content).

## Endpoints implemented in this pass (67)

Grouped by domain. Each maps onto an existing `doctor_*` table; no migration added.

### Clinical / appointments / prescriptions / calls / chat / emergency / AI (41)
`handler_clinical_tail.go`, `service_clinical_tail.go`, `repository_clinical_tail.go`

| Method | Path | Handler |
| --- | --- | --- |
| POST | /appointments/:appointmentId/start | StartAppointment |
| POST | /appointments/:appointmentId/end | EndAppointment |
| POST | /appointments/:appointmentId/cancel | CancelAppointment |
| POST | /appointments/:appointmentId/no-show | MarkNoShow |
| GET | /appointments/:appointmentId/clinical-note | GetClinicalNote |
| PUT | /appointments/:appointmentId/clinical-note | SaveClinicalNote |
| POST | /clinical-notes/:noteId/finalize | FinalizeClinicalNote |
| POST | /clinical-notes/:noteId/share | ShareClinicalNote |
| GET | /appointments/:appointmentId/hmo-eligibility | GetHMOEligibility |
| GET | /prescriptions/:id/issued | GetIssuedPrescription |
| POST | /prescriptions/:id/issue | IssuePrescription |
| POST | /prescriptions/:id/cancel | CancelPrescription |
| POST | /prescriptions/:id/share | SharePrescription |
| POST | /prescriptions/:id/pharmacy | AttachPrescriptionPharmacy |
| POST | /prescriptions/:id/send-to-pharmacy | SendPrescriptionToPharmacy |
| POST | /prescriptions/:id/refill-consultation | RequestRefillConsultation |
| GET | /calls/:appointmentId/pre-check | GetCallPreCheck |
| GET | /calls/:appointmentId/rich | GetCallRich |
| POST | /calls/:appointmentId/dispute | DisputeCall |
| POST | /calls/:appointmentId/feedback | SubmitCallFeedback |
| POST | /calls/:appointmentId/switch-provider | SwitchCallProvider |
| GET | /chat/:threadId/presence | GetChatPresence |
| GET | /chat/:threadId/rich-messages | ListChatRichMessages |
| GET | /chat/:threadId/state | GetChatState |
| GET | /chat/:threadId/transcript | GetChatTranscript |
| POST | /chat/:threadId/attachments | SendChatAttachment |
| POST | /chat/:threadId/end | EndChatThread |
| POST | /chat/:threadId/escalate | EscalateChatThread |
| POST | /chat/:threadId/share | ShareChatThread |
| POST | /chat/:threadId/voice | SendChatVoice |
| POST | /chat/messages/:messageId/report | ReportChatMessage |
| PUT | /chat/messages/:messageId/annotations | AnnotateChatMessage |
| GET | /emergency/cases/:id | GetEmergencyCase |
| POST | /emergency/cases | CreateEmergencyCase |
| POST | /emergency/contacts/:patientId/notify | NotifyEmergencyContact |
| POST | /emergency/escalate/ambulance | EscalateAmbulance |
| POST | /emergency/escalate/hospital | EscalateHospital |
| GET | /ai/note-summary/:appointmentId | GetStoredNoteSummary |
| GET | /ai/rx-safety/:id | GetStoredRxSafety |
| GET | /ai/lab-explanation/:resultId | GetStoredLabExplanation |

The three AI GET endpoints are advisory read-backs. AI generation persists nothing
(no table, by design), so they return an `AiEnvelope` with the mandatory disclaimer
instructing the client to (re)generate via the POST endpoint. They never call the
LLM and never fabricate clinical content.

### Account / profile / payouts / privacy / security / compliance / onboarding (23)
`handler_account_tail.go`, `service_account_tail.go`, `repository_account_tail.go`

| Method | Path | Handler |
| --- | --- | --- |
| POST | /profile/bank-account | CreateBankAccount |
| POST | /profile/documents | UploadProfileDocument |
| POST | /profile/photo | SetProfilePhoto |
| PUT | /profile/tax-info | UpdateTaxInfo |
| GET | /payouts | ListPayouts |
| GET | /payouts/:id | GetPayout |
| GET | /payout-report | GetPayoutReport |
| PUT | /payout-account | UpdatePayoutAccount |
| POST | /payouts/:id/dispute | DisputePayout |
| POST | /privacy/export | RequestPrivacyExport |
| POST | /privacy/delete | RequestPrivacyDelete |
| POST | /security/password | ChangePassword |
| GET | /compliance | GetCompliance |
| POST | /compliance/policies/:policyKey/ack | AckPolicy |
| GET | /onboarding/legal | GetLegalOnboarding |
| GET | /reputation | GetReputation |
| GET | /patients/:patientId/full-profile | GetPatientFullProfile |
| GET | /patients/:patientId/record-hub | GetPatientRecordHub |
| PUT | /presence | SetPresence |
| POST | /auth/logout | Logout |
| POST | /announcements/:announcementId/dismiss | DismissAnnouncement |
| POST | /support/technical | CreateTechnicalSupport |
| PUT | /schedule/emergency | SetEmergencySchedule |

`ChangePassword` stores no password (Supabase Auth owns credentials) — it records a
`security.password_change_requested` audit row. `Logout` and `DismissAnnouncement`
have no backing session/announcement table; they record a best-effort audit row and
return `{ok:true}`. `account_number` is masked to last-4 in every bank-account
response. Payout reads/requests do NOT post to the ledger — the real money path
(`RequestPayout`) is unchanged.

### Vet profile lifecycle (4)
`handler_vet_tail.go`, `service_vet_tail.go`, `repository_vet_tail.go`

| Method | Path | Handler |
| --- | --- | --- |
| POST | /vet/licence/renew | RenewVetLicence |
| POST | /vet/verification | SubmitVetVerification |
| POST | /vet/profile/publish | PublishVetProfile |
| PUT | /vet/profile/draft | SaveVetProfileDraft |

Vet verification writes `doctor_vet_profiles.verification` (the shared
`doctor_verifications.kind` CHECK does not allow a `vet`/role value). Publish is
fail-closed: it requires `verification = 'approved'`.

## Routes wired but NOT in the contract (5 — informational)

> The previous version of this file listed 59 extras. That list was an artifact
> of the undercounted (235-op) contract baseline — most of those 59 routes *are*
> in the contract once it is parsed correctly. Against the corrected 315-op
> baseline only **5** wired routes have no contract counterpart.

These are convenience/sub-resource routes wired in earlier waves whose contract
counterpart uses a different shape (e.g. the contract exposes `PUT /schedule/*`
write endpoints and a single aggregate `GET /schedule`, while these add granular
`GET /schedule/{recurring,reminders,vacation}` reads). Kept as-is (additive,
non-breaking). If strict parity is wanted later, add them to the contract.

```
GET  /schedule/recurring       (granular read; contract has GET /schedule + PUT /schedule/recurring)
GET  /schedule/reminders       (granular read; contract has GET /schedule + PUT /schedule/reminders)
GET  /schedule/vacation        (granular read; contract has GET /schedule + PUT /schedule/vacation)
GET  /vet/recommendations      (list read; contract has POST /vet/recommendations + GET /vet/pets/{petId}/recommendations)
POST /chronic-monitoring       (create; contract has GET/POST /vet/pets/{petId}/chronic-monitoring variants)
```

## Deferred operations

None. All 315 contract operations are wired (0 missing). No operation was
intentionally deferred.

## Needs-schema remainders

None. Every implemented operation maps onto an existing `doctor_*` table/column,
or returns a derived/static projection where no dedicated table exists (the two
Wave-3 cases noted above: `/announcements/latest` and the static content
catalogues). No migration was added in any wave.
