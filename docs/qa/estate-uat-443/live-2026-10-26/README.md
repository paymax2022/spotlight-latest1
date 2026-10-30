# estate-a live lane — 2026-10-26 (API_LIVE)

Executes the estate guard-authz / visitor cases against a **running Go backend**
instead of only against the in-process service, and adds the flag-off control
that proves `FEATURE_ESTATE_GUARD_GRANTS` is what changes the behaviour.

## Environment (all local, nothing production-reachable)

| Component | Value |
|---|---|
| Supabase local stack | `supabase_db_spotlight` (db `127.0.0.1:54322`), `supabase_kong_spotlight` (`127.0.0.1:54321`) |
| Go backend, flag ON | `APP_PORT=8093`, `FEATURE_ESTATE_GUARD_GRANTS=true`, `APP_ENV=development`, `REDIS_URL=` (empty) |
| Go backend, flag OFF | `APP_PORT=8094`, same env **without** `FEATURE_ESTATE_GUARD_GRANTS` (the shipped default) |
| Start command | `cd backend && set -a; . <env>; set +a; go run ./cmd/server` |
| HEAD | `f161b8975` (working tree also carried another session's unrelated `internal/app/finance_routes.go` additions — association push + `kv /ids/used`; untouched by this lane) |

`backend/.env` cannot be sourced as-is: line 258 is an unexpanded deploy
template (`REDIS_URL="${{Redis.REDIS_URL}}"`) and `set -a; . ./.env` aborts with
`bad substitution`. The runs above used a filtered copy with `REDIS_URL=` set
empty; that also skips the push/queue wiring, which this lane does not exercise.

## Identities and data

`01-identities.sh` creates four local auth users through the GoTrue admin API
(`estate-uat-{admin,guard,resident,outsider}@local.test`) and caches their
bearer JWTs **outside the repo** (`/tmp/estate-uat-live/tokens`, not committed).
`02-seed.sql` is additive, fixed-UUID, `ON CONFLICT DO NOTHING`: one estate
`UAT Gate Estate Alpha` (`0a1e5701-…-0001`), three memberships
(admin / two plain residents) and two gates. Before this run the local
`estates`, `estate_residents`, `estate_staff_grants`, `visitor_access_codes`
and `visitor_arrival_requests` tables all had **0 rows**.

## What was executed

| Script | Transcript | Result |
|---|---|---|
| `04-probe.sh` — flag ON, 31 HTTP assertions | `probe-guard-grants.out` | **31 PASS / 0 FAIL** |
| `05-probe-flagoff.sh` — flag OFF control, 5 checks | `probe-flag-off.out` | see notes below |
| outsider `GET /api/finance/estate` against both servers | `probe-discovery-control.out` | `{"data":null}` ON vs the estate listed OFF |
| `06-probe-bff.sh` — the **Next.js BFF** visitor/gate surface, 47 assertions | `probe-bff-goldenpath.out` | **46 PASS / 1 FAIL** (see "BFF lane" below) |

DB state after both lanes (`psql` on `supabase_db_spotlight`):
`grants=1 codes=28 gate_sessions=6 gate_events=16 incidents=1 blacklist=1
arrival_requests=2 (both approved, both consumed_at set)`. The Go lane alone had
left `codes=4 checkins=7 audit=15`; the BFF lane added the bulk-event, CSV,
single-use, watchlist, walk-in/emergency and handover rows. All of it is local
test data in the seeded estate `0a1e5701-…-0001`.

## Flag ON — what the live API actually enforces

1. **Fail closed without a grant.** `guard/lookup`, `guard/checkin`,
   `guard/expected-visitors` all return `403 estate: insufficient role` for a
   member with no grant and for an officer whose grant has been revoked or has
   `expires_at` in the past — with the *same* bearer token, no re-auth.
2. **Delegation is admin-only.** `POST /staff-grants` → `201` for the
   estate_admin, `403` for a plain member, `403` for a non-member; `estate_admin`
   itself is rejected as `400 estate: unknown staff role` (not grantable).
3. **Grant lifecycle.** revoke → immediate `403` on all three guard surfaces;
   re-grant with past `expires_at` → `403`; re-grant with `expires_at` +1h → `200`.
4. **Visitor golden path.** host issues a 2-use code → guard resolves it by
   numeric code and admits by numeric **and** QR → third admit `403`
   `entry denied: code has reached maximum uses` → guard checkout `201`.
5. **Host-approval gate (SP-02).** On a `require_host_approval` code with uses
   remaining: admit without approval → `403 awaiting host approval`; guard raises
   `guard/arrival-request` → `201 arrival_request_id`; host `…/decision {"approve":true}`
   → `200`; admit → `201`; **next** admit → `403 awaiting host approval` again,
   which is the single-use approval consumed in the checkin transaction; raising
   an arrival request for a code that needs no approval → `400`.
6. **Caller-scoped discovery.** With the flag on, a non-member's
   `GET /api/finance/estate` returns `{"data":null}`; members see their estate.

## Flag OFF (the shipped default) — the control

Same tokens, same database, server without the flag:

- a member **without any grant** reaches `guard/expected-visitors` (`200`) and
  passes guard authz on `guard/checkin` (it returns `403 access code not found`,
  i.e. the refusal is the code lookup, not the role — with the flag on the same
  request never gets that far);
- a **non-member** is still refused the gate surface (`403 estate: not a member`)
  and cannot delegate;
- **but** `GET /api/finance/estate` for a non-member returns the estate. That is
  `listAllEstates()` — the documented pre-#876 discovery behaviour, reachable
  whenever the flag is off, so *every authenticated user can enumerate every
  `status='active'` estate* by default.

## BFF lane (`06-probe-bff.sh`, EXEC-ESTA-021 / EXEC-ESTA-022)

The shipped mobile path — `/api/v1/visitor/**` on `next dev` at
`127.0.0.1:3000`, same Supabase database, same seeded estate, guard/resident/
nobody tokens. **46 PASS / 1 FAIL.**

Covered and proven over HTTP: guard shift open + read-back, non-member `403`,
unknown gate `404`; pass issue with its validation `400`s; manual numeric
lookup (`found:true`) vs unknown code (`found:false`, an answer not an error);
admit, single-use re-admit `409 Access code is used`, open-visits, checkout,
gate log; denial, walk-in and emergency admission; incident raised `201`
without consuming the pass (`entriesUsed 0 → 0`, `status=active`); plate scan
match + blank plate `400`; watchlist add → pass flagged at issue → gate
`403 Visitor is blacklisted`; bulk event codes `201` + CSV import `201`;
offline sync `{"synced":1}` then dedup `{"synced":0}` and `400` without a UUID;
handover closing the shift (every guard route then `403 No active gate
session`) and the next guard signing in at the other gate.

The one FAIL is a precondition check (`404` expected for "no shift started
yet") that found a shift left open by an **earlier aborted run** of the same
script — that run's requests all returned `000` when the shared dev server died
mid-run. Stale test state, not product behaviour.

Two deliberate negative probes, recorded as defects rather than passed over:

- **The BFF has no guard-role authorisation.** A plain resident with *no*
  `estate_staff_grants` row opened a gate session (`201`), read the
  expected-visitors list (`200`) and admitted a visitor (`200`). Membership is
  the only check. So the fail-closed guard authz proven on the Go stack above
  does not exist on the surface the app uses — `ESTA-D021` stays open.
- **`require_host_approval` is neither stored nor consulted.** A pass requested
  with `requireHostApproval: true` is written with `require_host_approval = f`
  (the insert list in `app/api/v1/visitor/codes/route.ts` omits the column; the
  string never appears anywhere under `frontend-web/app` or `src`), and the
  guard admitted it `200` with no host decision — `ESTA-D022` / `EST-UAT-0088`
  stay open.

Micro-findings from the same lane: lookup by uuid **id prefix** always answers
`found:false` because the PostgREST filter is `uuid ~~*`, which Postgres
rejects (`42883`, reproduced in `psql`), and the route discards the error
(`ESTA-D025`); CSV import returned `{"imported":2}` for a 3-row file with no
word about the dropped row (`ESTA-D026`); `POST /incidents` vocabulary is
`suspicious|incident` only — `kind=tailgating` is `400 Invalid kind`.
`import-sample.csv` is the exact 3-row file posted to `/codes/import` (two good
rows, one malformed).

**Attribution caveat:** the lane ran against a `next dev` server that was
already running in this worktree (PID 10456, later restarted as PID 28344) —
Next refuses a second dev server for the same project directory. Same branch,
same working tree, and that server also carries another session's traffic.

## Boundaries of this evidence (read before re-marking anything)

- `04-probe.sh`/`05-probe-flagoff.sh` cover the **Go** surface
  (`/api/finance/estate/:id/**`). The shipped mobile guard screen calls the
  **Next.js BFF** (`/api/v1/visitor/**`), which has its own model
  (`gate_sessions`, `visitor_gate_events`) and its own authz — so the Go results
  above say nothing about the BFF, and the BFF results say nothing about the Go
  stack. Both lanes were executed here; keep the two evidence sets apart when
  re-marking rows.
- The flag defaults to **false**, so none of the grant enforcement above is active
  in a stock deployment. It is proven capability, not shipped posture.
- `GET /:id/gates` (ListGates) is `assertResident`, **not** grant-gated — a
  revoked officer can still list gates. Confirmed live (`200` after revoke).
  Recorded here so nobody mistakes it for the guard surface.
- `guard/checkin` maps *every* denial to `403` (or `409` when blacklisted):
  exhausted code, expired window, missing host approval and lost race are only
  distinguishable from the message text, so a client cannot branch on cause.
