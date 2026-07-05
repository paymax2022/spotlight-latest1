# Estate — Production Readiness (Block 47)

_Release gate for the Estate product (blocks 25–46). Status as of this change set._

## 1. Security — role / permission matrix

Estate access is enforced centrally in `backend/internal/estate` via `assertRoles`
(`assertResident` = resident|estate_admin, `assertEstateAdmin` = estate_admin).
`assertRoles` now also **fails closed for banned or soft-deleted members**.

| Capability | resident | estate_admin | estate_security | vendor* |
|---|---|---|---|---|
| View dashboard / lists | ✅ | ✅ | ✅ | — |
| Issue visitor code | ✅ (unless hard-restricted) | ✅ | — | — |
| Gate check-in / scan | — | ✅ | ✅ | — |
| Pay dues | ✅ | ✅ | — | — |
| Vote (KYC/payment/restriction gated) | ✅ | ✅ | — | — |
| Book facility (soft/hard restriction blocks) | ✅ | ✅ | — | — |
| Create meeting / minutes / approve | — | ✅ | — | — |
| Create invoice / apply restriction | — | ✅ | — | — |
| Property mgmt / transfers review | — | ✅ | — | — |
| Admin dashboard / rules / ban / audit-log | — | ✅ | — | — |
| AI notes generate / approve | — | ✅ | — | — |
| Vendor onboard / job lifecycle / payout | — | — | — | ✅ (own jobs) |
| Run maintenance | — | ✅ | — | — |

\* Vendors authenticate as their own `estate_vendors` row (`resolveVendorID`), not the resident role matrix.

**Cross-estate isolation:** every query is `WHERE estate_id=$1`; mutations re-check
membership/role. Contract tests: `isolation_test.go`. Pure policy tests:
`restriction_test.go`, `election_eligibility_test.go`, `property_mgmt_test.go`,
`settings_test.go` (partial-update contract), `vendor_test.go` (payout fail-closed).

**Recommended before launch:** add DB-backed integration tests asserting a member of
estate A cannot read/mutate estate B's properties, payments, documents, incidents
(the harness in this repo, `/tmp/replay.py` + a seeded fixture, is the basis).

## 2. Data protection — PII inventory & retention

| Table | PII | Retention / deletion |
|---|---|---|
| `resident_profiles` | bio, photo, phones, emergency/next-of-kin (JSONB), lease docs | Scrubbed by `SoftDeleteAccount` → blanked + visibility `admin_only` |
| `household_members` | name, DOB, ID type/number, photo | Deleted by `SoftDeleteAccount` |
| `domestic_staff` | name, ID, phone, photo | Deleted by `SoftDeleteAccount` |
| `resident_vehicles` | plate, docs | Deleted by `SoftDeleteAccount` |
| `visitor_access_codes` / `visitor_checkins` | visitor name/phone/plate, arrival photos | Retain per security policy; consider a purge job (see §4) |
| `gate_incident_reports` | description, evidence URL | Retain for security/audit window |
| `estate_documents` | uploaded files (R2 object keys) | Approval-gated; restricted docs admin-only |
| `estate_ai_notes` | transcript, summary | Admin-owned; approval workflow |
| `estate_payments` / `estate_dues_invoices` | financial records | Immutable financial records — **never deleted** (ledger source of truth) |
| `estate_vendors` | bank_account (JSONB) | Scrub on vendor offboarding (follow-up) |

Account deletion is **soft** (`estate_residents.deleted_at`): membership/financial
history is preserved while personal data is anonymised. Auth credentials are managed
by Supabase Auth and are out of scope for the estate service.

## 3. Audit coverage

Immutable events are written to `estate_audit_log` (append-only). Covered actions:

- Dues: `DUES_PAY`, `RESTRICTION_APPLY`, `RESTRICTION_LIFT`
- Gate: `GATE_CHECKIN` (scan/admission)
- Meetings: create/start/end/cancel/reschedule, minutes upload/approve
- Property: update, assign, occupancy, archive, transfer request/review
- Elections: `ELECTION_ELIGIBILITY_SET`
- Vendor: onboard, job assign, lifecycle transitions, `VENDOR_PAYOUT`
- Admin: `RESIDENT_BAN`, `RESIDENT_RESTORE`, `ESTATE_CONFIG_SET`, `MAINTENANCE_RUN`
- AI notes: `AI_NOTES_GENERATE`, `AI_NOTES_APPROVE`
- Account: `ACCOUNT_SOFT_DELETE`
- Emergencies: `EMERGENCY_RAISE`

Money-path mutations additionally retain the append-only ledger
(`backend/internal/finance/ledger`) as the financial source of truth.

**Gaps to close before GA:** document-download access logging; CSV export logging.

## 4. Background jobs (Block 47)

Idempotent maintenance jobs in `backend/internal/estate/jobs.go`:

| Job | Effect | Idempotency |
|---|---|---|
| `MarkOverdueInvoices` | pending dues past `due_date` → `overdue` | re-run is a no-op (status filter) |
| `AutoApplyOverdueRestrictions` | soft restriction for residents with overdue dues | `(estate_id,resident_id) WHERE active` partial unique index |
| `ExpireAccessCodes` | active codes past `valid_until` → `expired` | re-run is a no-op (status filter) |

Entry points:
- `RunEstateMaintenance(estateID, adminID)` — admin-triggered, one estate
  (`POST /api/finance/estate/:id/admin/run-maintenance`).
- `RunMaintenanceAllEstates()` — platform-wide, for a scheduled worker.

**Scheduling:** run `RunMaintenanceAllEstates` hourly from a worker process (asynq
periodic task or `robfig/cron`). Restriction lift on payment is already handled
synchronously in `PayDues`.

**Follow-ups:** visitor-overstay notification, meeting/task reminders, repair SLA
escalation, subscription-expiry sweep, analytics rollups.

## 5. Performance

Hot-path indexes: `20260622030000_estate_indexes.sql` (list paths) +
`20260623210000_estate_perf_indexes.sql` (maintenance sweeps, gate numeric-code
lookup, resident dues, notification feed, AI notes, audit-log). The resident
dashboard is a single fan-out query (Block 26); analytics are single-query
aggregates (Block 44).

## 6. Disaster recovery — runbook

**Backups**
- Database: Supabase automated daily backups + PITR. Verify PITR window covers RPO.
- Object storage: Cloudflare R2 bucket `spotlight-open-mic` — enable versioning;
  estate object keys are namespaced `estate/<estateID>/<userID>/<kind>/...`.
- Queue: asynq/Redis is transient; jobs are idempotent and safe to replay.

**Restore**
1. Restore DB from the latest backup / PITR target.
2. Re-point R2 credentials (server-side only) and verify presign issues URLs.
3. Re-run pending migrations: `supabase db push` (suite is clean-replayable —
   validated 163/166, PostGIS-deps apply on Supabase).
4. Run `RunMaintenanceAllEstates` once to reconcile overdue/expiry state.
5. Smoke-test per actor (resident, admin, security, vendor).

**Migration safety:** all estate migrations are additive (no DROP/rename/narrowing);
verified replayable from scratch via the repo's replay harness.

## 7. Go-live checklist

- [ ] All `FEATURE_ESTATE_*` flags default **off**; enable per environment.
- [ ] `ANTHROPIC_API_KEY` set (AI notes use `claude-sonnet-4-6`; absent ⇒ 503, never fabricated).
- [ ] `R2_*` configured (uploads/downloads presign; absent ⇒ 503).
- [ ] `REDIS_URL` set (push notifications enqueue; absent ⇒ in-app feed only).
- [ ] Scheduled worker runs `RunMaintenanceAllEstates` hourly.
- [ ] `go test ./...` green; OpenAPI (`contracts/estate.openapi.yaml`) validates.
- [ ] `supabase db push` applied to target; PostGIS extension present.
- [ ] Money flows reconcile: ledger entries ↔ `estate_payments`/`vendor_jobs` payouts.
- [ ] Role/cross-estate integration tests pass (see §1).
