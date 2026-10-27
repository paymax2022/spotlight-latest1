# Estate UAT cluster C — modules M12–M17 (EST-UAT-0232..0347)

Lane: `estate-c` · branch `uat/estate-c` · worktree `/tmp/uat-estate-c`.
Cases: 116 (M12 25, M13 16, M14 20, M15 15, M16 20, M17 20).
Results: **18 PASSED · 41 BLOCKED · 55 FAILED (missing features, defects logged) · 2 NEEDS_MANUAL.**
Implementation verdict: 30 IMPLEMENTED · 41 PARTIAL · 45 MISSING.
Defects: 18 logged (ESTC-D001..D018) — **9 fixed this lane, 9 recorded** (feature builds beyond lane scope).

Env premise lifted on 2026-10-26: three rows (`0232`, `0234`, `0341`) cite "no live backend" alongside a
product gap in their evidence column. The local Supabase stack is reachable again and the `TestLiveDB`
suite ran 60 PASS / 0 FAIL / 0 SKIP against it (EXEC-ESTA-014, `SUMMARY.md`), so the blocker for those
rows is now the missing behaviour itself.

That live-DB pass was completed on 2026-10-27 (`E16` in `exec-estate-b.csv`, `EXEC-C017` in
`exec-estate-c.csv`, log `live-2026-10-26/livedb-estate-suite.log`). Read test-by-test instead of by
suite name, it converts **no** estate-c row: the 60 tests cover dues, meetings, votes, escrow,
delegation, notifications and vendor-payout mechanics, while this lane's open rows assert facility,
document, announcement, procurement and export behaviours nothing exercises. The one estate-c row the
run does speak to — `0286` (vendor payout) — stays `FAILED`, and its evidence now carries the executed
proof (`_VendorPayout_RejectedWhenJobNotCompleted` + `_CompletedJobCreditsVendorWallet`: `status =
'completed'` is the only gate; no PO, no invoice match). The details are in the "Phase 1 harvest"
section of `SUMMARY.md`.

## Surfaces audited

Two live API surfaces exist for the same estate domain, and they had drifted:

- Go backend `backend/internal/estate` mounted under `/api/finance/estate`
  (routes in `backend/internal/app/finance_routes.go:1253-1440`,
  oversight routes in `estate_admin_routes.go`).
- Next.js BFF `frontend-web/app/api/v1/estate/**` used by web + mobile
  (`mobile-app/reactnative/src/features/*` calls `/api/v1/...`), reading the
  same Supabase tables via the service-role client.

Admin pages exist: `frontend-admin/app/admin/estate/{facilities,vendors,ops,content}`.
Mobile screens exist: `app/facilities/*`, `app/vendors/*`, `app/vendor-portal`,
`app/guard/incident.tsx`, `app/estate-notifications`.

## Environment honesty

`go test ./internal/estate/...`, `go vet`, `go build`, vitest (8 estate spec
files, 62 tests), golden-path regression (138/138) and `tsc --noEmit` all pass
in this worktree. The live backend could NOT be exercised: `localhost:8080` is
owned by an unrelated OrbStack container that 401s every path, and the local
Supabase instance is not running (`supabase status`: no container). All
live-API acceptance steps are therefore `BLOCKED` with `method=CODE_REVIEW`
evidence, not fabricated passes.

## Fixes landed this lane (conventional commits on uat/estate-c)

| Defect | Sev | Fix |
|---|---|---|
| ESTC-D001 double-booking | S2 | Overlap + capacity check in `BookFacility` and BFF bookings POST; `maxConcurrentBookings` helper + unit test; durable exclusion constraint parked as pending SQL |
| ESTC-D002 vendor-job authz | S2 | BFF `vendors/jobs` GET scoped to admin | own-vendor | 403; status POST requires admin or owning vendor |
| ESTC-D003 emergency list privacy | S2 | `ListEmergencies` + BFF GET scoped: responders see all, residents see own |
| ESTC-D004 repairs list privacy | S2 | BFF repairs GET scoped to reporter for non-admins (matches Go) |
| ESTC-D005 unapproved vendors listed | S3 | `ListVendors` + BFF GET show verified-only to non-admins |
| ESTC-D006 opt-out ignored | S3 | `pushAllowed()` consults `estate_member_settings` before push; `security` category exempt (life-safety); in-app feed always persists |
| ESTC-D007 no resident sign-off | S3 | New `PATCH /estate/repairs/[id]` accept/reject, reporter-only, state-gated, audited via `repair_updates` |
| ESTC-D008 decline reason lost | S4 | `RejectJobWithReason` persists reason to audit log |
| ESTC-D009 unaudited downloads | S4 | `DOCUMENT_DOWNLOAD` audit on both download-URL paths |

Money rules preserved: no new money mutations added; vendor payout path
(`RequestPayout`) untouched apart from review — it remains
idempotent, ledger-balanced, kobo-integer. Booking-fee capture (ESTC-D010) and
refund (ESTC-D011) were deliberately NOT half-built; they need a real ledger
flow and are recorded as defects.

## New tests (executed, green)

- `backend/internal/estate/booking_capacity_test.go` — capacity slot rule.
- `backend/internal/estate/notifications_test.go` + `TestOptOutColumnMap` —
  life-safety categories can never be opted out.
- `frontend-web/tests/unit/estate/facility-booking-conflict.spec.ts` (7)
- `frontend-web/tests/unit/estate/vendor-jobs-authz.spec.ts` (7)
- `frontend-web/tests/unit/estate/estate-list-scoping.spec.ts` (7)
- `frontend-web/tests/unit/estate/repair-signoff.spec.ts` (5)

## What exists vs what the UAT expects (per module)

### M12 Facilities, assets & maintenance — PARTIAL
Working: facility CRUD, booking with member/restriction/overlap gates,
repair tickets with append-only updates, vendor assignment + accept/decline +
quote + evidence, dues-restriction block on booking (unit-tested).
Missing: asset registry (tags, warranty, service schedules), SLA engine,
preventive schedules, blackout calendar, meter readings, projects, anonymous
reports, quote-approval/budget thresholds, closure flag, fee capture and refund
policy (ESTC-D010..D016).

### M13 Documents — PARTIAL
Working: presigned R2 upload (server-controlled keys, content-type bound into
the signature, extension allowlist), estate-scoped list with restricted
filtering, 60-minute presigned download gated by role, audited download.
Missing: versioning, approval workflow, expiration, acknowledgement, e-sign,
soft-delete/retention, bulk export, malware scan, magic-byte sniffing, true
upload-size binding (declared-size check only), search beyond category.

### M14 Vendors, procurement & contracts — PARTIAL
Working: self-onboarding (pending), admin verify/suspend, verified-only
directory, job lifecycle (available→accepted→en_route→in_progress→completed→
paid) with strict ownership, idempotent ledger payout (fail-closed, audited),
earnings summary.
Missing: RFQ, sealed bids + deadlines, contracts, conflict declarations,
authority matrix/budget checks, three-way match, credential expiry, ratings,
renewals, procurement spend report (ESTC-D012).

### M15 Announcements — PARTIAL (thin)
Working: create/list/mark-read, estate-wide in-app + push broadcast, read
receipts per user, cross-estate isolation, opt-out now enforced on push
(ESTC-D006).
Missing: building/role targeting, draft-approve, scheduling/cancel, pinning,
attachments, edit history, mandatory acknowledgement, moderation, per-channel
delivery records (ESTC-D014).

### M16 Emergencies & incidents — PARTIAL
Working: SOS/fire/medical alert kinds (validated), severity mapping, responder
broadcast (admin+security), list privacy (fixed), admin resolve/reopen, guard
incident reports with evidence + escalated flag, offline gate sync, concurrent
alerts isolated.
Missing: acknowledgement, escalation timers, geo/building targeting,
estate-wide evacuation broadcast, resident cancel, update feed, false-report
control, responder failover, closing evidence/review fields, response metrics
(ESTC-D015).

### M17 Reports & exports — PARTIAL
Working: 9 analytics types with tested date-window logic, finance dashboard,
admin dashboard, dues reconciliation, election audit route, per-estate RBAC on
every aggregate, append-only audit log.
Missing: export formats/jobs/schedules, PII-export controls, rent roll,
expense side, SLA/response-interval metrics, data-as-of stamps (ESTC-D017).

## Recommendations for consolidation

1. ~~Apply `migrations-estate-c/facility_booking_overlap_exclusion.pending.sql`~~ — **already
   promoted** on 2026-10-22 (`dc9c4163d`) as
   `supabase/migrations/20271068000030_facility_booking_overlap_exclusion.sql`, and the exclusion
   constraint `facility_bookings_no_overlap` is live in the local database (checked 2026-10-27).
   Re-executing the double-booking race case is Phase 5/8 verification work, not a promotion.
2. Prioritise ESTC-D010/D011 (fee booking dead-ends) — residents currently
   cannot complete a paid reservation or receive any refund.
3. The BFF and Go service now agree on scoping rules; keep them aligned —
   D002–D005 were BFF/Go drift bugs of exactly this kind.
4. Cross-lane note: `estate_residents` role strings (`estate_admin`,
   `estate_security`) are relied on by D003/D006 fixes; other lanes should
   reuse `roleIn` semantics rather than inventing parallel checks.
