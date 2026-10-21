# Cluster C — Events 8.16–8.22: Organiser reporting, settlements, admin governance, support, security, integration, NFR

Run: 2026-10-21, worktree `/tmp/uat-events-c` @ `uat/events-c` (base main `f0816a2c4`).
UAT source: `events_ticketing_UAT_workplan_test_cases.md` §8.16–8.22, cases EVT-UAT-208…299 (92).

## Environment

- Supabase: shared local `spotlight` project (supabase-db, 616 migrations applied — started by a sibling lane).
- Go backend built from this worktree (`go build ./cmd/server`), run on `:8091` with
  `FEATURE_EVENTS_*` sub-flags on (EDIT_LIFECYCLE, TICKETING_DEPTH, TEAM_ROLES, COMPS),
  COMMISSION + DISPUTES on. NOTE: `:8080` on this host is an unrelated OrbStack container —
  `GET /readyz` there answers `{"error":"Unauthorized"}` for every path; it is NOT this backend.
- Fixture users (GoTrue admin API, documented dev password): `admin@spotlight.internal`
  (super-admin, via ensure-dev-login.sh), `uat-evtc-orga@example.test`, `uat-evtc-orgb@example.test`,
  `uat-evtc-buyer@example.test` (has cashtag `uatcbuyer`).
- Synthetic fixtures (SQL, ids `*000000-0000-4000-8000-*`): events A1 (orga, LIVE→CLOSED),
  A2 (orga, `<script>`-title, suspended via admin), B1 (orgb, LIVE); tiers GA ₦500.00 cap 100
  (sold 3) / VIP ₦1000.00 (sold 1); orders o1–o4 (3 PAID, 1 REFUNDED); tickets incl. 1 USED, 1 REFUNDED,
  and one NULL-credential row; one COMP ticket issued via API.

## Module map

| Surface | Location |
| --- | --- |
| Go events module (member) | `backend/internal/top5events` → `/api/finance/events/*` (RequireAuthContext + requireUserID) |
| Go events admin | same module → `/api/events/admin/*`, per-route RBAC `events.approve|suspend|settle|admin.view` |
| BFF proxy | `frontend-web/app/api/v1/events/**` → proxies `/api/finance/events/**` |
| Legacy admin (in-memory) | `frontend-web/app/api/admin/events/**` + `src/server/admin/events` — separate non-Go store |
| Mobile | `mobile-app/reactnative/app/events/**`, `src/features/events` (organiser dashboard/attendees/scanner) |
| Admin console | `frontend-admin/app/admin/events/**` + `src/services/eventsAdminService.ts` (mock-default; `NEXT_PUBLIC_EVENTS_USE_MOCK=false` → live `/api/events/admin/*`; several review functions throw `NO_BACKEND_YET`) |
| Shared dispute rail | `backend/internal/finance/disputes` → `/api/finance/disputes` + `/api/finance/admin/disputes/:id/resolve` (platform-shared) |

Money model: ticket checkout debits the buyer's **platform wallet into the escrow standing
account** (not an external gateway). Vendor cashless float settles escrow→vendor(net)+escrow→revenue(fee)
via `SettleVendor`. **No organiser disbursement rail exists** — ticket-sale proceeds never leave escrow
for the organiser; on cancel, 90% refunds to payer + 10% fee to platform revenue.

## Results by module

| § | Cases | Pass | Fail | Partial/Blocked/NA |
| --- | --- | --- | --- | --- |
| 8.16 Organiser ops & reporting (208–219) | 12 | 8 | 4 (213,215,216,219 gaps) | — |
| 8.17 Earnings & settlements (220–233) | 14 | 2 (220,229) | 12 (no payout rail) | — |
| 8.18 Admin governance (234–248) | 15 | 4 (234,236,243 partial+,245 blocked) | 9 | 245 shared-platform BLOCKED; 244/248 conditional |
| 8.19 Support & disputes (249–257) | 9 | 1 (250 partial) | 8 | shared `finance/disputes` rail is a bare status store |
| 8.20 Security & privacy (258–272) | 15 | 9 | 1 (265 rate limit) | 5 NEEDS_MANUAL/shared |
| 8.21 Integration failures (273–284) | 12 | 7 | 0 | 5 platform-shared/infra BLOCKED |
| 8.22 Perf/device/a11y (285–299) | 15 | 3 partial | 0 | 12 NEEDS_MANUAL |

## Key findings

**Fixed this lane (commit `659d9a394`):**
- EVTC-D001: organiser + admin KPIs overstated sales — derived `sold*price_kobo` counted refunded
  tickets at list price, comps as revenue, ignored promos, windowed on event creation. Now order-derived:
  live re-verify `gross 150000→100000`, `sold 4→3`, refunds 50000, checked_in 1, net 90000, avg 66666.
- EVTC-D010: `GET /my/tickets` 500'd on any ticket with NULL `credential_id`
  (`can't scan NULL into *string`) — sibling query already COALESCEd; both queries fixed. Verified live.

**Recorded defects:** EVTC-D002 reporting drill-down/statement gaps · EVTC-D003 no organiser payout rail (S1, 12 cases) · EVTC-D004 admin review gaps (no reject/reason/reactivate/fee-versioning) · EVTC-D005 admin dashboard empty surfaces + no impersonation/maker-checker · EVTC-D006 dispute resolve marks `refunded` but moves no money for events (live-verified, shared_platform) · EVTC-D007 dispute `reference` accepts foreign order ids (live-verified, shared_platform) · EVTC-D008 no events support-case model · EVTC-D009 no rate limiting on purchase/scan/discovery (live burst) · EVTC-D011 XSS payloads stored raw · EVTC-D012 sync CSV export, no expiring download · EVTC-D013 suspend has no reason/unsuspend · EVTC-D014 denied attempts not audited.

## Live probe evidence (highlights)

- 401 unauthenticated on member + admin routes; 403 non-admin on `/api/events/admin/*`; invalid/stale token → `invalid token` 401.
- CSV: `?format=csv` returns roster; name `=cmd|/c calc!A0` exported as `'=cmd…` (escaped); cross-event CSV → 403; stewards excluded from export by design (`authorizeManage`).
- Tamper: POST purchase `{tier_id, price:1, total_kobo:1, discount:100}` → order row written at server-computed `total_kobo=50000`, then EXPIRED on tier-0 wallet gate. Price never trusted from client.
- Lifecycle: create→submit→admin approve→suspend all live; approve replay → 400; suspended event hidden from discovery, purchase → `state SUSPENDED` 400; draft invisible to stranger (404).
- Disputes: `POST /api/finance/disputes` accepted `module_type:"events"` + foreign order ref → 201 (D007); admin resolve → `resolved/refunded` with no money movement (D006).
- Burst: 12× POST purchase same-second → all 400 (tier gate), never 429 (D009).
- Audit: `audit_logs` rows for events.create/submit/approve/suspend/cancel/close/announce/comp/purchase with actor + entity + timestamp; denied attempts not logged (D014).
- Comps: POST `/:id/comps` → 201 zero-value COMP ticket + credential; replay same idemKey → same ticket, no double issue; stranger → 403.

## Tests executed

- `TEST_DATABASE_URL=postgres://…:54322 go test ./internal/top5events` → **177 tests PASS, 0 FAIL** (includes every TestLiveDB_* suite: cancel 90/10 refunds, comp idempotency, CSV authZ, scan authZ, settle crash-safety, tier gates, money invariants).
- `cd frontend-web && vitest run tests/unit/events/route.spec.ts` → 7/7 PASS (BFF route contract).
- `go vet ./internal/top5events` clean.

## Honesty notes

- PASSED requires executed evidence: live API calls or the live-DB suite above. NEEDS_MANUAL/BLOCKED
  means exactly that (device labs, load tooling, infra DR, shared fixtures we must not mutate).
- Admin console for events defaults to fixtures (`USE_MOCK`); several console actions
  (`reject`, `request_changes`, payout decisions, fraud actions) throw `NO_BACKEND_YET` — mapped to D004/D005.
- The web "organiser portal" does not exist; organiser surface is the RN app + member API.
- `frontend-web/app/api/admin/events/**` is a separate in-memory stub store unrelated to the Go
  module — noted so consolidation doesn't double-count it as the events admin path.
- Fixtures left in local DB for retest (marked `UAT-C *`, `uat-evtc-*`, dispute `76885b4d…`,
  comp ticket `45cc9af8…`). Event A1 left CLOSED, A2 SUSPENDED.
