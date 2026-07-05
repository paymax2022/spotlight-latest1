# Estate Blocks 25–47 — QA Audit Against Acceptance Criteria

_Date: 2026-06-23 · Read-only audit of migrations, Go services/routes, and React Native screens vs. `PAYMAX_BUILD_PLAYBOOK.md` acceptance criteria._

## Headline

The earlier todo list ("blocks 25–47 to be built") was wrong — most blocks have schema + a CRUD slice. But the playbook's `✅ DONE` markers on blocks 25–28 are **also wrong**: none of 25–47 fully meet their acceptance criteria. Reality sits in between: a solid data layer and a thin CRUD/list backend, with mobile, money flows, R2 uploads, push, analytics, and the release gate largely unbuilt.

The **one fully-correct money path is dues `PayDues`** (balanced double-entry ledger, fail-closed idempotency, tier check, immutable receipt row). Every other "money" criterion (facility booking debit, repair quote approval, refunds, vendor payouts) is **not implemented**.

## Verdict table

| Block | Playbook says | Actual | Headline gap |
|---|---|---|---|
| 25 Resident Profile | ✅ DONE | **PARTIAL** | All 9 mobile screens missing; no R2 presigned photo upload (QR ✅, admin verify ✅) |
| 26 Home Dashboard | ✅ DONE | **PARTIAL** | Multi-query fan-out (fails "single query/no N+1"); 5/7 aggregates never populated; no mobile screen |
| 27 Visitor Codes | ✅ DONE | **PARTIAL** | `BulkUploadGuests` missing; no visitor-side blacklist screen (6-digit ✅, uniq ✅, recurrence ✅, blacklist-block ✅, WhatsApp ✅) |
| 28 Guard App | ✅ DONE | **PARTIAL** | `LookupResident`/`LogVehicleEntry` missing; `manual`+`offline` screens + AsyncStorage queue missing; incident evidence not R2-presigned |
| 29 Property Mgmt | pending | **MISSING** | 8/9 services, all 5 routes, 7/8 screens absent |
| 30 Dues/Rent | pending | **PARTIAL** | Money path correct ✅. No rent/outstanding/receipt-API/proof/waiver; soft/hard restriction matrix unenforced (only hard facility); no R2 receipt |
| 31 Elections Ext. | pending | **MISSING** | No nominations/eligibility/disputes tables, services, routes. **CastVote has no KYC/payment gating** |
| 32 Meetings | pending | **MISSING** | 3 tables scaffolded; zero services/routes/working UI |
| 33 AI Notes | pending | **MISSING** | Flat table missing transcript/status; no services/routes; LLM is `claude-3-5-sonnet-latest`, not `claude-sonnet-4-6`, and estate never calls it |
| 34 Tasks | pending | **PARTIAL** | Basic CRUD. Schema is single `assignee_id` not `assigned_to[]`; no checklist/source/comments/escalate/approve |
| 35 Repairs | pending | **PARTIAL** | No quote/approve/assign/complete funcs; **no wallet debit at all**; no `repair_evidence` |
| 36 Facilities | pending | **PARTIAL** | `BookFacility` does **no debit/idempotency/ledger**; no cancel/refund; no QR column |
| 37 Announcements | pending | **PARTIAL** | No community forum; **push never wired to queue**; no audience/push_sent |
| 38 Emergencies | pending | **PARTIAL** | No escalate/notify; no anonymous/response_notes; no detail route |
| 39 Documents | pending | **PARTIAL** | **No R2 presign (PUT or GET)** anywhere; manual URL paste; no approve flow |
| 40 Finance Dash | pending | **PARTIAL** | Dashboard scalars only; no summary/ledger/CSV-export/reconcile/refund |
| 41 Admin Panel | pending | **MISSING** | 0/7 services, 0/6 routes, no admin sub-screens, no landlord screens |
| 42 Vendor App | pending | **MISSING** | 0/11 services, 0/7 job routes, no vendor_jobs migration, no RequestPayout |
| 43 Notif Types | pending | **MISSING** | **0 of 18** types; generic notif infra + Expo push exists but unused by estate |
| 44 Analytics | pending | **MISSING** | **0 of 9** endpoints; only one generic `/reports` |
| 45 Settings | pending | **MISSING** | No change-password/DELETE-profile/anonymise; mock-only settings screen |
| 46 Empty/Error | pending | **PARTIAL** | Shared `StateView` good & used; no named `EstateEmptyState`/`EstateErrorBoundary`, no error boundary |
| 47 Release Gate | pending | **MISSING** | Indexes ✅ + immutable audit_log ✅ (partial coverage); no cron jobs, no role-matrix tests, mocks in live screens, OpenAPI path mismatch, no runbook/PII inventory |

Tally: **0 DONE · 11 PARTIAL · 11 MISSING** (of 22 product blocks; 47 is the gate).

## Cross-cutting issues (fix once, helps many blocks)

1. **R2 uploads are never presigned.** The estate package never imports `internal/platform/r2`. Profile photos (25), incident evidence (28), and documents (39) all accept client-supplied URL strings; mobile `documents/upload.tsx` literally asks the user to paste an `https://` link. Presign exists only in the doctor module.
2. **Most "money" flows do no money.** Only `PayDues` posts to the ledger. Facility booking (36), repair quote approval (35), refunds (40), and vendor payout (42) move no funds and have no idempotency.
3. **Push/queue never wired to estate.** A generic `notifications` package with asynq + Expo push exists, but estate emits 0 of the 18 required notification types (43) and never enqueues.
4. **Mobile is mock-default.** `estateadmin`, `vendors`, `reports`, `estatesettings`, `notifications` feature modules ship `USE_MOCK` on, so "no live screen depends on placeholder data" (47) fails today.
5. **Restriction matrix unenforced.** Soft vs. hard restriction (30) is only checked in `BookFacility` (hard only). Voting and visitor-code paths ignore restrictions.
6. **CastVote ungated.** Residents can vote with no KYC and no dues check (31) — the highest-risk correctness gap.
7. **Contract drift.** `contracts/estate.openapi.yaml` uses `/estate/...` (no `{id}`) while code uses `/api/finance/estate/{id}/...`, and omits all 41/42/44/45 routes — so OpenAPI does not cover implemented routes (47).

## Corrected remaining-tasks list (estate)

**Finish the "DONE"-marked blocks (highest ROI — backend mostly there):**
- B25: build 9 profile mobile screens + R2 presign endpoint for profile photo.
- B26: rewrite `GetDashboard` as a single query, populate the 5 empty aggregates, build the dashboard screen.
- B27: add `BulkUploadGuests` (+route) and a visitor blacklist screen.
- B28: add `LookupResident` + `LogVehicleEntry`; build `manual`/`offline` screens + AsyncStorage offline queue; R2 presign for incident evidence.

**Complete the PARTIAL blocks:**
- B30: PayRent, GetOutstandingBalance, receipt API + R2 PDF, proof + waiver tables/services/routes; enforce soft/hard restriction matrix across voting + visitor codes; 14 mobile screens.
- B34: migrate to `assigned_to[]`, add checklist/source; `task_comments`; AssignTask/AddComment/EscalateTask/ApproveTaskCompletion; calendar screen.
- B35: quote/approve (idempotent wallet debit + ledger), assign/complete/confirm/reopen; `repair_evidence`; quote/rate/schedule screens.
- B36: real idempotent `BookFacility` debit + ledger; `CancelBooking` refund (reversing entry); `qr_code` column + ScanBookingQR; [id]/confirmation/history screens.
- B37: community_posts/post_comments; wire PublishAnnouncement to queue/push; audience + push_sent; forum screens.
- B38: anonymous + response_notes columns; EscalateIncident (notify staff/admin); detail route; panic/[id]/history screens.
- B39: R2 presigned PUT + GET (60-min TTL); ApproveDocument; [category]/[id] screens.
- B40: GetEstateRevenueSummary, GetResidentLedger, CSV export, ReconcilePayments, ProcessRefund (reversing entry); ledger/defaulters/export/refund screens.
- B46: add named `EstateEmptyState` + `EstateErrorBoundary` (real error boundary); QR-expiry state.

**Build the MISSING blocks (essentially greenfield on top of base schema):**
- B29 Property Mgmt · B31 Elections Extended (incl. KYC+payment vote gating) · B32 Meetings · B33 AI Notes (switch model to `claude-sonnet-4-6`) · B41 Admin + Landlord · B42 Vendor app · B43 18 notification types · B44 9 analytics endpoints · B45 Settings + soft-delete/anonymise.

**Release gate (B47):** role/permission matrix tests; broaden immutable audit coverage (scans, bans, refunds, doc-access, admin-config, exports); background jobs (overstay, overdue, restriction apply/restore, reminders, SLA, subscription expiry, rollups); observability; PII inventory; flip mobile off mock; reconcile OpenAPI ↔ routes; DR + launch runbook.

## Non-estate items still genuinely open
- BLOCKED (env/human): `supabase db push`; merchant-onboarding E2E smoke test.
- Telemedicine "export PDF visit summary" — `TODO(Phase C)` still at `summary.tsx:80`.
- Zero unit tests in `platform/db`, `platform/queue`, `platform/redis`, `platform/ws`, `repositories`.
