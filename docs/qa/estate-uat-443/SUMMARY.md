# Estate & Visitor Access (443) — UAT consolidation summary

**Date:** 2026-10-21  |  **Runbook:** `docs/qa/UAT-OCT-2026-RUNBOOK.md`  |  **RTM rows:** 443 / 443 source cases

## Roll-up by lane

| Lane | Main commit | Rows | Passed | Failed | Blocked | Not run | Needs manual | N/A | Other | Defects (S1/S2/S3/S4) | Fixed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| estate-a | `ff51e2a8d` | 115 | 20 | 0 | 93 | 0 | 2 | 0 | — | 23 (2/12/9/0) | 10 |
| estate-b | `d51071c7d` | 116 | 40 | 7 | 5 | 64 | 0 | 0 | — | 12 (3/4/5/0) | 7 |
| estate-c | `21934eafa` | 116 | 18 | 55 | 41 | 0 | 2 | 0 | — | 18 (0/12/4/2) | 9 |
| estate-d | `db97402fc` | 96 | 41 | 0 | 35 | 0 | 19 | 0 | 1 | 35 (5/17/13/0) | 9 |
| **Total** | | **443** | **119** | **62** | **174** | **64** | **23** | **0** | 1 | 88 | |

`Passed` means an executed check (unit / live-DB integration / live API) per the runbook's evidence rule; code reading alone never yields `Passed`. `Other` = non-schema result values kept verbatim from the lane (`PARTIAL`, `PASSED_D<n>` = passed after that lane's defect fix).

## Open S1/S2 defects (not fixed by any lane)

| Defect | Sev | Lane | Title | Status | Platform-owned |
|---|---|---|---|---|---|
| ESTD-D014 | S1 | estate-d | MFA flag is advisory — not enforced for high-risk roles | RECORDED | yes |
| ESTD-D025 | S1 | estate-d | No estate lifecycle state — cannot verify or suspend an estate | RECORDED | no |
| ESTD-D027 | S1 | estate-d | No maker-checker / approval-threshold controls on admin actions | RECORDED | no |
| ESTD-D028 | S1 | estate-d | No support impersonation surface | RECORDED | yes |
| ESTD-D034 | S1 | estate-d | No legacy-data import/migration tooling for estate | RECORDED | no |
| ESTA-D010 | S2 | estate-a | Estate lifecycle & governance schema absent: no draft/publish/verify/deactivate/transfer/tz/branding | RECORDED | no |
| ESTA-D011 | S2 | estate-a | Estate role model is binary (resident/estate_admin): no finance/gate/election/facility/auditor/temporary delegations | RECORDED | no |
| ESTA-D012 | S2 | estate-a | Merchant onboarding lacks withdraw/suspend/reactivate; resubmit only from NEEDS_MORE_INFO | RECORDED | yes |
| ESTA-D017 | S2 | estate-a | QR payload unsigned; no offline cached-credential admission policy | RECORDED | no |
| ESTA-D021 | S2 | estate-a | No per-gate assignment, supervisor-override permission, identity check, or device binding at the gate | RECORDED | no |
| ESTA-D022 | S2 | estate-a | Resident real-time approval flow absent (approve/decline/timeout) | RECORDED | no |
| ESTB-D011 | S2 | estate-b | Secret-ballot schema split required (voter->choice unlinkability) | RECORDED | no |
| ESTC-D010 | S2 | estate-c | Fee-based facility booking can never be confirmed: no payment/confirm endpoint | RECORDED | no |
| ESTC-D011 | S2 | estate-c | Booking cancellation has no refund-cutoff policy or ledger refund | RECORDED | no |
| ESTC-D012 | S2 | estate-c | Procurement model absent: no RFQ/bids/contracts/authority-matrix/three-way-match/credential-expiry/ratings/renewals/spend summary | RECORDED | no |
| ESTC-D013 | S2 | estate-c | Document governance absent: versioning/approval/expiration/ack/e-sign/soft-delete/bulk-export/malware-scan/magic-byte-type-check/presign-size-binding | RECORDED | no |
| ESTC-D014 | S2 | estate-c | Announcement governance absent: targeting/draft-approve/scheduling/pin/attachments/edit-history/mandatory-ack/moderation/per-channel delivery tracking | RECORDED | no |
| ESTC-D015 | S2 | estate-c | Incident workflow absent: ack/escalation/geo-target/responder-failover/false-report-control/resident-cancel/update-feed/resolution-evidence/reopen-justification/response-metrics | RECORDED | no |
| ESTC-D016 | S2 | estate-c | Asset & maintenance planning absent: asset tags/registry/warranty/SLA rules/preventive schedules/blackout calendar/meter readings/projects/quote-approval thresholds/closure flag | RECORDED | no |
| ESTC-D017 | S2 | estate-c | Report exports absent: CSV/XLSX/PDF, async jobs, scheduled email, PII minimisation/watermark, data-as-of stamps, rent roll, expense side | RECORDED | no |
| ESTD-D009 | S2 | estate-d | No malware/virus scan stage on uploads | RECORDED | no |
| ESTD-D013 | S2 | estate-d | Non-money-path audit writes are fire-and-forget | RECORDED | no |
| ESTD-D015 | S2 | estate-d | No data-subject access (export) endpoint | RECORDED | no |
| ESTD-D016 | S2 | estate-d | No retention purge or legal-hold gate on visitor/estate records | RECORDED | no |
| ESTD-D018 | S2 | estate-d | No report export (CSV/XLSX/PDF) — formula-injection N/A but feature absent | RECORDED | no |
| ESTD-D020 | S2 | estate-d | Platform auth/RLS/session/provider concerns outside lane scope | RECORDED | yes |
| ESTD-D024 | S2 | estate-d | No platform-level provider application queue for estate vendors | RECORDED | no |
| ESTD-D026 | S2 | estate-d | No cross-estate global configuration rollout | RECORDED | no |
| ESTD-D029 | S2 | estate-d | User disable does not trigger gate-shift handover | RECORDED | no |
| ESTD-D033 | S2 | estate-d | No suspicious-access-denied aggregation/alerting | RECORDED | no |
| ESTD-D035 | S2 | estate-d | No formal rollback path/tooling beyond additive-only policy | RECORDED | no |

## Pending schema changes (NOT applied)

Per runbook rule 5, lanes wrote no migrations. These drafts still need review (additive-only, version-collision check) before being promoted into `supabase/migrations/` and replayed with `supabase db reset`:

- `estate-uat-443/migrations-estate-a/estate_properties_unique_unit.pending.sql`
- `estate-uat-443/migrations-estate-b/20261021000000_estate_payments_one_receipt_per_invoice.pending.sql`
- `estate-uat-443/migrations-estate-b/20261021000001_estate_election_secret_ballot.pending.sql`
- `estate-uat-443/migrations-estate-c/facility_booking_overlap_exclusion.pending.sql`
- `estate-uat-443/migrations-estate-d/estate_notifications_archive.pending.sql`
- `estate-uat-443/migrations-estate-d/estates_lifecycle_status.pending.sql`

Per-module narrative and evidence: `cluster-<lane>.md`; ledgers: `rtm-/defects-/exec-<lane>.csv` in this directory.
