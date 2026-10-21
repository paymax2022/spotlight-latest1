# UAT October 2026 — Estate / Events / Stays parallel swarm

Three user-supplied UAT packs executed in parallel, mirroring the `docs/qa/food-uat-332`
cluster model. Authoritative method: the universal UAT directive at
`../Generic_Claude_Code_UAT_Audit_Build_Test_100_Percent_Master_Prompt.md` (workspace root).

## Source packs (live outside the repo, at workspace root)

| Pack | File | Cases | Modules | Case IDs |
|---|---|---|---|---|
| Estate & Visitor Access | `../Estate_Visitor_Access_UAT_Workplan_Test_Cases.md` (+ .xlsx) | 443 | M01–M23 | EST-UAT-0001..0443 |
| Events & Tickets | `../events_ticketing_UAT_workplan_test_cases.md` (+ .xlsx) | 299 | 8.1–8.22 | EVT-UAT-001..299 |
| Stays (Hotel + Short-let) | `../Stays_Hotels_Shortlets_UAT_Workplan.md` + `../Stays_Hotels_Shortlets_UAT_Master_Workbook.xlsx` | 365 | REQ-ACC..REQ-NFR | ACC-001…, MRB-…, SHT-…, HTL-…, SRH-…, RAT-…, BKS-…, BKH-…, PAY-…, OPS-…, MOD-…, COM-…, FIN-…, ADM-…, SEC-…, INT-…, NFR-… |

## Lanes (10 parallel agents, one worktree + branch each)

| Lane | Worktree | Branch | Scope | Cases |
|---|---|---|---|---|
| estate-a | /tmp/uat-estate-a | uat/estate-a | Estate M01–M06 | 115 |
| estate-b | /tmp/uat-estate-b | uat/estate-b | Estate M07–M11 | 116 |
| estate-c | /tmp/uat-estate-c | uat/estate-c | Estate M12–M17 | 116 |
| estate-d | /tmp/uat-estate-d | uat/estate-d | Estate M18–M23 | 96 |
| events-a | /tmp/uat-events-a | uat/events-a | EVT 8.1–8.7 | 98 |
| events-b | /tmp/uat-events-b | uat/events-b | EVT 8.8–8.15 | 109 |
| events-c | /tmp/uat-events-c | uat/events-c | EVT 8.16–8.22 | 92 |
| stays-a | /tmp/uat-stays-a | uat/stays-a | REQ-ACC/MRB/SHT/HTL/SRH/RAT/BKS/BKH | 179 |
| stays-b | /tmp/uat-stays-b | uat/stays-b | REQ-PAY/OPS/MOD/COM/FIN/ADM/SEC/INT/NFR | 186 |
| platform | /tmp/uat-platform | uat/platform | Shared auth/OTP/session, merchant-upgrade pipeline, RBAC middleware, ledger/idempotency/webhook infra + environment baseline | cross-cutting |

## Per-lane deliverables (inside the pack dir)

- `cluster-<lane>.md` — narrative per-module findings (exists vs works, evidence)
- `rtm-<lane>.csv` — one row per source case (pre-seeded header)
- `defects-<lane>.csv` — defects with severity, repro, root cause, fix commit
- `exec-<lane>.csv` — every execution attempt (command, env, result, timestamp)
- e2e/unit specs where executable: `mobile-app/reactnative/tests/e2e/<pack>-uat/` or `frontend-web/tests/unit/`

## Schemas

`rtm-<lane>.csv`: `case_id,module,title,priority,classification,implementation,code_locations,result,evidence,defect_ids,notes`
- classification: `APPLICABLE | CONDITIONAL | NOT_APPLICABLE | AMBIGUOUS`
- implementation: `IMPLEMENTED | PARTIAL | MISSING`
- result: `PASSED | FAILED | BLOCKED | NOT_RUN | NEEDS_MANUAL | NOT_APPLICABLE`

`defects-<lane>.csv`: `defect_id,title,severity,case_ids,component,file_paths,expected,actual,root_cause,fix_status,fix_commit,shared_platform`
- defect_id: `<LANE>-D###` (e.g. `ESTA-D001`, `EVTB-D003`); severity: `S1|S2|S3|S4`
- shared_platform: `yes` when the defect lives in platform-owned code (recorded, not fixed by the lane)

`exec-<lane>.csv`: `execution_id,case_id,method,command_or_procedure,env,result,evidence_path,executed_at_utc`
- method: `CODE_REVIEW | UNIT_TEST | INTEGRATION_TEST | API_LIVE | UI_LIVE | E2E | MANUAL`

## Non-redundancy rules

1. Each case is owned by exactly one lane for reporting.
2. Platform-owned code (see below) is fixed only by the platform lane. Domain lanes
   record defects there with `shared_platform=yes` and move on.
3. Platform-owned paths: `backend/internal/platform/**`, `backend/internal/middleware/**`,
   `backend/internal/money/**`, `backend/internal/finance/ledger*.go`,
   `backend/internal/repositories/**`, `backend/internal/handlers/**`,
   `backend/internal/webhooks/**`, `backend/internal/otp/**`,
   `backend/internal/onboarding/**`, `backend/internal/provider/**`,
   `frontend-web/src/middleware.ts`, `frontend-web/app/api/webhooks/**`,
   `contracts/**`, `.github/**`, `supabase/migrations/**`, root configs/CI.
4. Everything else a lane's modules touch is lane-owned. Within a pack, lanes share
   top-level domain dirs (e.g. `backend/internal/estate/`); keep diffs to shared
   router/handler files minimal and note them as `shared_touched` in the report.
5. No new migrations from lanes. If a case needs schema change, drop a
   `*.pending.sql` under `docs/qa/<pack>/migrations-<lane>/` and record the gap.
   Orchestrator applies/renumbers at consolidation.
6. No edits to protected legacy Spotlight modules (contests/voting/applicants/legacy
   auth) — wrap only via vote-bridge.
7. Money rules hold: integer minor units, Idempotency-Key on mutations, balanced
   double-entry, no direct balance UPDATEs.

## Evidence honesty

- `PASSED` requires an actual executed check (unit/integration/live call) with
  recorded command + output evidence, not code inspection alone.
- Code inspection yields `implementation` status and `result=BLOCKED`/`NEEDS_MANUAL`
  with the reason, or an execution row with `method=CODE_REVIEW`.
- Never fabricate env access, credentials, or results.

## Consolidation (2026-10-21)

All 10 lanes squash-merged to `main`, one commit per lane:

| Lane | Commit | | Lane | Commit |
|---|---|---|---|---|
| estate-a | `ff51e2a8d` | | events-b | `672ccc610` |
| estate-b | `d51071c7d` | | events-c | `d979e0b5d` |
| estate-c | `21934eafa` | | stays-a | `b80e23258` |
| estate-d | `db97402fc` | | stays-b | `1c433106b` |
| events-a | `68977ad98` | | platform | `2ab54fdb5` |

Lane-branch SHAs cited in `defects-*.csv` `fix_commit` remain reachable on the `uat/<lane>` branches.

**Cross-lane overlaps resolved at merge** (same feature built twice; one kept):
- estate-c `pushAllowed` vs estate-d `notificationAllowed` → kept estate-d's (feed/push split, dedupe, live-DB tested).
- events-a vs events-b tiers-on-`GetEvent` → kept events-b's `tiersForEvent` (deterministic ordering).
- stays-a vs stays-b direct `book_token` v2 TTL → kept stays-b's (expiry embedded in token, clock-injectable `decodeBookTokenAt`, v1 refused); kept stays-a's `priceStay` rate-calendar/restriction evaluation and stays-b's refundable-flag policy snapshot alongside it.

**Integration seams fixed after merge** (`3c009aed8`): estate-c specs mocked the pre-estate-a/b `getResidentContext` query (no `.is()`); the realtor money-path spec predated estate-b's ESTB-D005 atomic claim (added claim-lost 409 + claim-release tests); estate-c's `PATCH /estate/repairs/{id}` added to `contracts/estate.openapi.yaml`. 93 ledger rows with unquoted commas re-quoted (`b6edc793f`).

**Verification on merged main**:
- `backend`: `go build ./...`, `go vet ./...` clean; `go test ./...` all packages pass (live-DB suites skip without `TEST_DATABASE_URL`); lefthook golangci-lint clean on every lane commit.
- `frontend-web`: `vitest run` 199 files / 1,839 tests pass; `test:regression` green; `tsc --noEmit` clean; `contract:check` in sync.
- `mobile-app/reactnative` `typecheck`: only failures are unresolved `livekit-client` / `@livekit/react-native` modules in `src/features/academy/live/*` (not touched by this wave).
- NOT run: `go test -race` against a clean DB, `make verify`, migration chain replay, mobile Playwright e2e.

**Outstanding before any module sign-off**:
1. Review and promote the 13 `*.pending.sql` drafts (listed in each pack's `SUMMARY.md`) into `supabase/migrations/`, then `supabase db reset` + `scripts/ci/check-migration-versions.sh`.
2. Large `NOT_RUN`/`BLOCKED` blocks need a live environment: stays-a (146 not run), estate-a (93 blocked), events-b (51 blocked + 32 not run), estate-b (64 not run).
3. Open S1s are product gaps, not regressions: see each pack's `SUMMARY.md`.
