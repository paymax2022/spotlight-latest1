# Agent 5 notes — infrastructure / deployment / test residuals

Scope: FULL_AUDIT.md §Infrastructure, §Reliability, §Testing, §Documentation.
Re-verified against `origin/main` @ c37a1562 (2026-10-02). This file does not
modify the audit ledger; it records current-state verification and residuals.

## Verified FIXED (no action taken)

| Finding | Evidence of fix |
|---|---|
| AUD-INFRA-007 healthz/readyz | `backend/internal/app/router.go:441-442` registers both; `Ready` pings the pgx pool (`admin_overview.go:364`, rate-limited probe). |
| AUD-INFRA-008 canary gate | `deploy.yml` "Watch canary golden signals" probes the tagged-revision URL — **but see residual below**. |
| AUD-INFRA-009 backup/PITR runbook | `docs/devops/backup-restore-runbook.md` (98 lines) covers Supabase Postgres base backups/PITR tiers, pg_dump→R2 offload, restore-drill checklist, and R2/GoTrue/Redis-as-ephemeral notes. Adequate; the flagged action item (confirm plan tier / enable PITR add-on) is an operator task. |
| AUD-INFRA-001 ipAllowList | `render.yaml` Redis/Postgres allowlists are private-only. |
| AUD-INFRA-006 workers | `render.yaml` declares notification-worker + marketplace-cron/indexer + transport-scheduler. |
| AUD-TEST-001/002/004 | Full vitest green per ledger; `go build` compiles; ci-optimized Go pins now use `go-version-file: backend/go.mod` repo-wide (verified — no stale `1.23`/`1.25.x` pins remain). Phantom `lint:fast`/`tsc || true` lanes replaced by real scripts (still `|| true` non-blocking — documented soft lanes). |
| AUD-TEST-005 | lefthook hook uses `env -u GIT_DIR -u GIT_INDEX_FILE -u GIT_WORK_TREE ... --new-from-rev HEAD` — commits in this linked worktree pass the hook. |
| AUD-SEC-002 Dependabot posture | `.github/dependabot.yml` covers gomod (backend, crypto-backend, tools/fakes), npm (frontend-web, frontend-admin, mobile), github-actions, docker. `security.yml` has govulncheck + per-module npm-audit lanes with baselines. |

## Changes made

1. **PR #403 — `ci(deploy)`: canary gate now probes `/readyz`, consecutive successes required.**
   The #313 fix probed `/healthz`, which is a static-200 liveness body — a
   canary that boots but can't reach the DB still promoted. `/readyz` pings
   the shared pool, and the 3-successes-required counter is now reset on any
   failure so a crash-looping revision can't accumulate lucky hits.
   *Remaining gap (unchanged):* no error-rate/latency evaluation under live
   traffic — that needs Cloud Monitoring metric wiring; noted in the step
   comment.

2. **PR #405 — `chore(scripts)`: TEST_ENDPOINTS.sh modernized.**
   Hardcoded `localhost:8000` (compose exposes `:8080`), literal
   `YOUR_VALID_TOKEN_HERE` placeholder, `set -e` abort-on-first-curl-fail,
   and a summary that printed "completed!" even when every call failed.
   Now env-configurable, fail-aggregating, bounded (`--max-time 15`), and
   warns it performs real writes (local/staging only).

## Contract drift check

`cd frontend-web && npm run contract:check` — **green, no drift**:
19 contract files valid (1861 documented operations); estate spec in sync
(46/46 operations).

## Dependabot triage — 13 open PRs, ALL major-version bumps (none merge-ready)

No safe patch/minor PRs are currently open. Do not batch-merge; each needs
per-PR compatibility review.

### Highest risk — toolchain/runtime

| PR | Bump | Risk |
|---|---|---|
| #134 | golang 1.26→1.27-alpine (backend Dockerfile) | Image ahead of `go 1.26.6` directive; verify toolchain + govulncheck matrix |
| #122 | node 20→26-alpine (frontend-admin) | Node 26 pre-LTS vs documented Node 20 deploy targets (cPanel Passenger) |
| #49 | alpine 3.20→3.24 (backend) | Low-moderate; musl/package drift possible |

### CI action majors (test on a scratch branch, cheap to validate)

| PR | Bump |
|---|---|
| #142 | google-github-actions/auth 2→3 |
| #48 | google-github-actions/setup-gcloud 2→3 |
| #47 | supabase/setup-cli 1→3 (skips v2) |
| #50 | expo/expo-github-action 8→9 |

### App/dev-dep majors (expect breakage)

| PR | Bump | Risk |
|---|---|---|
| #66 | typescript 6→7 (frontend-web) | TS majors break strict type-check; large surface |
| #54 | typescript 5.9.3→7.0.2 (frontend-admin) | Same; also skips v6 |
| #233 | vitest 4→5 (frontend-admin) | Test-runner major; check vitest.config compat |
| #234 | jsdom 29→30 (frontend-admin) | Usually safe with vitest; pair with #233 |
| #238 | @hookform/resolvers 3→5 (mobile) | Resolver API breaking changes |
| #237 | babel-preset-expo 54→57 (mobile) | **Must match the Expo SDK version** — do not bump independently; close or fold into an Expo upgrade |

## Operator-actionable residuals (not code changes)

- **AUD-TEST-003 residual**: `scripts/ci/apply-branch-protection.sh main` still
  needs an admin-token run — checks exist on main now, but protection isn't
  API-applied (`maintain`-scope token gets 404).
- **AUD-INFRA-005**: `db-migrate.yml` remains dormant pending repo secrets
  (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`,
  `DB_MIGRATE_ENABLED`) — correct to keep dormant until the reconciliation
  runbook is executed.
- **deploy.yml staging TODO**: "sandbox money-path round-trip" — deliberately
  not attempted; needs a sandbox-railed endpoint choice, not a drive-by.
- **AUD-INFRA-009 action item**: confirm Supabase plan tier / PITR add-on
  (ledger data-loss tolerance < 24h requires it).
- **AUD-DOC-002**: `task-tracker.json` mid-build feature statuses — needs
  feature owners' verification, not editable from this lane.
