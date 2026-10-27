# Cluster estate-d — Estate M18–M23 (notifications, reliability, security, a11y/NFR, super-admin ops, migration)

Lane: `uat/estate-d` · worktree `/tmp/uat-estate-d` · run date 2026-10-21.
Source cases: `EST-UAT-0348..0443` (96 cases) from `Estate_Visitor_Access_UAT_Workplan_Test_Cases.md`.
Artifacts: `rtm-estate-d.csv` (96 rows), `defects-estate-d.csv` (ESTD-D001..D035), `exec-estate-d.csv`, pending SQL in `migrations-estate-d/`.

## Execution environment

- `go test ./internal/estate/...` green before and after changes (2 pkgs, ~94 tests).
- Live Postgres available at `localhost:54322` → `TEST_DATABASE_URL`-gated live-DB suites ran for real (not skipped). Eight new live-DB tests authored for the notification layer all pass.
- Backend on `:8080` is up but `/readyz` returns 401 (auth-gated) — no anonymous estate endpoints exist to probe; live API execution was done at the service layer against the real DB instead.
- No device matrix, load harness, or provider sandboxes — M21 device/perf cases are NEEDS_MANUAL/BLOCKED with code-level evidence recorded.

## Results by module

Current tally counted from `rtm-estate-d.csv` on 2026-10-26 (the RTM is the authority):

| Module | Cases | PASSED | BLOCKED | NEEDS_MANUAL | Other |
|---|---|---|---|---|---|
| M18 Notifications & inbox | 14 | 11 | 2 | 1 | 0 |
| M19 Integration & reliability | 15 | 6 | 6 | 3 | 0 |
| M20 Security/privacy/fraud | 20 | 13 | 6 | 1 | 0 |
| M21 A11y/perf/device | 20 | 5 | 4 | 11 | 0 |
| M22 Super admin & audit | 15 | 8 | 4 | 2 | 1 |
| M23 Migration/rollback | 12 | 8 | 3 | 1 | 0 |
| **Total** | **96** | **51** | **25** | **19** | **1** |

The single `Other` is EST-UAT-0423 (user disable), whose `result` cell keeps the
lane's original `PARTIAL` verbatim — see the `Other` note in `SUMMARY.md`.

Below is the 2026-10-21 authoring snapshot. It mixes the `implementation`
(`PARTIAL→code-verified`, `MISSING`) and `result` vocabularies, which is why it no
longer lines up with the RTM; it is kept for the reasoning, not for the counts.

| Module | Cases | PASSED | PARTIAL→code-verified | MISSING | BLOCKED / NEEDS_MANUAL |
|---|---|---|---|---|---|
| M18 Notifications & inbox | 14 | 10 | 2 | 0 | 2 (0356 token, 0359 retention UI layer) |
| M19 Integration & reliability | 15 | 5 | 6 | 2 (0368 virus scan, 0371 search index) | 4 (provider outage/rotation/backlog) |
| M20 Security/privacy/fraud | 20 | 12 | 4 | 3 (0388 DSAR export, 0394 CSV export, 0385 MFA enforce) | 2 (platform-auth exec, restore drill) |
| M21 A11y/perf/device | 20 | 3 | 6 | 1 (0412 export) | 10 (device/perf harness) |
| M22 Super admin & audit | 15 | 3 | 4 | 7 | 1 |
| M23 Migration/rollback | 12 | 2 | 4 | 6 | 0 |

## What existed vs. what was fixed

### M18 — Notifications (the biggest gap: taxonomy existed, delivery semantics didn't)

**Existed:** 18-type taxonomy, `estate_notifications` feed table with RLS owner-scope, `Notifier` push interface to the platform asynq queue, per-category deep links, `estate_member_settings` with per-category + push toggles, BFF routes (list/read/read-all/unread-count), mobile inbox screen with deep-link navigation and a11y roles.

**Did not exist / fixed this lane:**
- `NotifVisitorArrived` was a dead constant — neither `ScanVisitorPass` nor `CheckInVisitor` emitted it (ESTD-D001). Both now notify the pass/code issuer; live-tested.
- `estate_member_settings` was never read by `notify()` — muted users still got everything (ESTD-D002). `notificationAllowed` now gates category mutes (feed+push) and `push_enabled` (push only); `emergency_alert` and `admin_approval_required` bypass mute as safety/legal notices.
- No replay dedupe (ESTD-D003). `notify()` now suppresses an identical (estate,user,category,title,body) notification inside a 10-minute window; verified live (replay → 1 row + 1 push; different body → still delivered). No schema change needed.
- `NotifPaymentOverdue`, `NotifRepairUpdate`, `NotifElectionReminder` were dead constants. Fixed: maintenance job now notifies payers on pending→overdue flip (ESTD-D004); `AddRepairUpdate` notifies only the requester (ESTD-D005); new admin-triggered `POST /:id/meetings/:mid/remind` (nonresponders only, ESTD-D006) and `POST /:id/elections/:electionId/remind` (nonvoters only, ballot-private by construction — the query selects only `voter_id`, never `candidate_id`, ESTD-D007). All live-tested.

**Remaining gaps (recorded):** inbox has no `archived_at`/retention sweep (pending SQL dropped); push token retirement on rejection is platform-notifications owned (ESTD-D019); emergency channel fan-out is push-only (no SMS fallback in estate scope).

### M19 — Integration contracts

Strong where the estate service owns the contract: payment webhook replay is claim-guarded (`OnChargeSuccess` early-returns confirmed intents, `ClaimForProcessing` gates concurrent delivery); pass validity and code state are evaluated against server time and current DB state at scan time so out-of-order/revocation events converge; presigned uploads fail closed with 503 and server-controlled keys, so a mid-upload outage can only orphan an unreferenced R2 key, never a public document; membership checks hit the DB per request (no stale access cache); maintenance jobs are idempotent.

Missing/partial: no virus-scan stage on uploads (ESTD-D009); no search index (ESTD-D010); list endpoints use hard LIMITs without cursor/offset traversal beyond audit-log (ESTD-D011); `CreateRepair`/`CreateTask` have no business-key idempotency (ESTD-D012); non-money `audit()` is fire-and-forget so a logging outage can drop audit while the action commits (ESTD-D013). Provider outage/secret-rotation cases are platform-owned (ESTD-D020).

### M20 — Security & privacy (all P0)

Verified clean by code review + existing tests: object-level authorization (owner/estate scoping on invoices, checkin history, documents), parameterised SQL everywhere in the module, no HTML injection sink (React/RN text rendering, no `dangerouslySetInnerHTML` in estate surfaces), presigned upload/download path with allowlists + TTL + membership gate, audit log is INSERT-only with SELECT-only RLS, no secrets on estate API responses or logs.

Fixed: `POST /estate/:id/emergencies` now sits behind `PerUserRateLimit(redisClient, "estate-sos", 12)` — bounds scripted SOS floods while staying far above real emergency cadence (ESTD-D021).

Recorded: no DSAR export (ESTD-D015); no retention purge or legal-hold gate (ESTD-D016 — **superseded
2026-10-27**: the legal-hold columns, service refusal and DB delete trigger shipped in `caef65516` and
are live-proven by `TestLiveDB_Lifecycle_LegalHoldBlocksPurge`; what remains open is the *scheduled
purge* of expired visitor records); audit metadata doesn't systematically capture prior/new values (ESTD-D017); no report export so CSV injection is N/A-but-feature-missing (ESTD-D018); MFA flag on member settings is advisory, not enforced (ESTD-D014, shared); platform auth/CSRF/session/JWT cases recorded shared (ESTD-D020) — a prior pass already documented the platform-wide `user_profiles` RLS PII exposure; not re-fixed here.

### M21 — Accessibility, performance & device

Executed evidence: payment network-drop → `IdempotentReplayReturnsCanonicalReceipt` + `ConcurrentSameKeySettlesExactlyOnce`; ballot network-drop/turnout → `ConcurrentDuplicateVote_ResultsInOneBallot`; NGN `₦%.2f` formatting + timestamptz + client-side relative time confirmed in code.

Partial: emergency reconnect can duplicate an alert (ESTD-D022); resident offline drafts absent though guard offline-sync exists (ESTD-D023).

Device/browser/screen-reader/perf-target cases (0397-0404, 0408-0410, 0412-0413, 0416): NEEDS_MANUAL/BLOCKED — no device matrix or load rig in this environment; code-level notes recorded (a11y roles present on notification list, indexed scan path, stateless handlers).

### M22 — Super admin & operations

**Existed:** `GET /api/finance/estate-admin/*` read-only oversight (gates, incidents, shifts, visitor logs, emergencies, dues reconciliation/invoices/payments/restrictions, repairs/tasks/meetings/facilities, announcements/documents, elections+results+integrity audit) behind seeded `estate.admin.*` RBAC slugs; `frontend-admin/app/admin/estate/*` pages (12 sections); per-estate admin dashboard KPIs, resident ban/restore, config, audit log; platform `users.suspend` RBAC route.

**Fixed:** added `GET /estate-admin/audit` (ESTD-D032) — cross-estate audit search filterable by `estate_id`, `actor_id`, `action` (prefix), `subject_type/_id`, `from`/`to` RFC3339, capped at 500, guarded by `estate.admin.security` (audit oversight is a security function; no dedicated slug is seeded).

**Missing (recorded):** ~~no estate lifecycle state at all — `estates` has no status column, so neither
verification queue (0418) nor suspension (0419) is implementable without schema work (pending SQL
dropped, ESTD-D025)~~ — **superseded 2026-10-27**: `estates.status` and `legal_hold` exist
(`20271068001000_estates_lifecycle_status.sql`, `caef65516`, present in the local database and verified
via `docker exec supabase_db_spotlight psql`), the queue and suspension transitions are live-proven by
`TestLiveDB_Lifecycle_VerificationQueue` / `_Transitions` (0418/0419 were re-marked PASSED on
2026-10-26), and what is left is that `FEATURE_ESTATE_LIFECYCLE_ENABLED` still defaults to **false**, so
the shipped binary does not expose them; no platform provider-application queue (ESTD-D024); no global config rollout (ESTD-D026); no maker-checker/approval thresholds for estate admin actions (ESTD-D027, S1); no impersonation surface anywhere (ESTD-D028, S1, shared); user disable doesn't hand over gate shifts (ESTD-D029); no incident banner/SLA owner tracking (ESTD-D030); no per-estate feature flags (ESTD-D031); no suspicious-access alerting (ESTD-D033).

### M23 — Historical data, rollback & reconciliation

The estate module has **no import/migration tooling whatsoever** — no endpoints, batch tables, exception reports, dry-run or delta support (ESTD-D034, S1: covers 0432-0435, 0437, 0439-0441). Partially covered by existing invariants: stale imported codes can never grant entry because scan-time checks are server-authoritative (0436); the payments idempotency-key + ledger `Posted()` guard would dedupe replayed gateway transactions if an importer reused those keys (0438); native-path date validation exists (0439); additive-only migration policy limits blast radius (0442, ESTD-D035). Post-release smoke evidence = this lane's executed suites (0443).

## Defect summary

35 defects recorded: **9 fixed this lane** (D001-D007, D021, D032), 26 recorded open. By severity: S1 ×5 (D014 MFA, D025 lifecycle, D027 maker-checker, D028 impersonation, D034 import tooling), S2 ×13, S3 ×17. `shared_platform=yes`: D014, D019, D020, D028, D031.

## Shared-file touch note

`backend/internal/app/finance_routes.go` and `backend/internal/app/estate_admin_routes.go` are router files under `internal/app` shared with other lanes' merge surface. Changes are additive line-level (2 route registrations, 1 rate-limit wrapper, 1 handler) — minimal-diff, noted per runbook rule 4.
