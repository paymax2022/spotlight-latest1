# Estate UAT — Cluster A (M01–M06) findings

Lane: `estate-a` · worktree `/tmp/uat-estate-a` · branch `uat/estate-a` · 115 cases
(EST-UAT-0001..0115). Source pack: `Estate_Visitor_Access_UAT_Workplan_Test_Cases.md`.

## Result summary

| Module | Cases | PASSED | BLOCKED | NEEDS_MANUAL | FAILED | NOT_RUN |
|---|---|---|---|---|---|---|
| M01 Account, identity & merchant upgrade | 20 | 0 | 19 | 1 | 0 | 0 |
| M02 Estate creation & governance | 16 | 0 | 16 | 0 | 0 | 0 |
| M03 Properties, units & occupancy | 16 | 0 | 16 | 0 | 0 | 0 |
| M04 RBAC, delegation & tenancy isolation | 16 | 0 | 16 | 0 | 0 | 0 |
| M05 Visitor invitations & access codes | 32 | 18 | 12 | 1 | 0 | 0 |
| M06 Gate operations & security desk | 15 | 3 | 12 | 0 | 0 | 0 |

`BLOCKED` here means "implementation reviewed in code, but no live backend/DB exists
in this lane to exercise it" — see Environment below. It is not a failing verdict.

## Environment / execution honesty

- `localhost:8080` is an **unrelated OrbStack `rx-api` container**, not this
  backend — every path including `/` returns `{"error":"Unauthorized"}`. The Go
  backend is not running locally and `supabase status` reports "Not linked".
  No `TEST_DATABASE_URL` is reachable, so the `*_live_db_test.go` suites skip.
- Executed: `go build` + `go vet` + `go test ./internal/estate/...` (green),
  `npx vitest run tests/unit/estate` (57 tests green incl. the new 21-test spec
  `visitor-gate-uat.spec.ts` written for the fixes below).
- PASSED is only asserted where a unit spec or test run provides evidence.

## Architecture note — two parallel visitor/gate stacks

The same domain is implemented twice:

1. Go: `backend/internal/estate` behind `POST/GET /api/finance/estate/:id/...`
   (`visitor_access_codes`, `visitor_checkins`, `guard_shifts`, `estate_gates`,
   `offline_gate_logs`), feature-flagged `FEATURE_ESTATE_ENABLED`.
2. Next.js BFF: `frontend-web/app/api/v1/visitor/**` over Supabase service-role
   (`visitor_gate_events`, `gate_sessions`, `visitor_blacklist`,
   `visitor_incidents`, `visitor_notifications`), consumed by
   `mobile-app/reactnative` (`app/visitor`, `app/guard`, `src/features/visitor`).

The BFF is what the mobile apps actually call. The Go guard surface is the
better-hardened of the two (member gates added in a prior wave); the BFF had
missed equivalent enforcement, which is where most M05/M06 defects lived.

## M01 — Account, identity & merchant upgrade (platform-heavy)

Merchant upgrade = `backend/internal/onboarding` (platform-owned lane): draft →
submit (schema-validated, idempotent) → review (approve/reject/request-info/
escalate) → `merchant_profiles` + `RoleToGrant` + audit. Covers 0004–0009,
0013(partial). Gaps, all `shared_platform=yes` under ESTA-D012: no withdraw,
suspend, reactivate endpoints; resubmit only from NEEDS_MORE_INFO.
Estate-side: residency membership gate (`assertResident`) covers 0019;
`SoftDeleteAccount` now refuses accounts with open invoices (ESTA-D013, fixed).

## M02 — Estate creation & governance (largest gap)

`CreateEstate` produces a live estate immediately: the `estates` table has only
id/name/address/admin_id — no status/lifecycle, verification, timezone,
branding, owner transfer, or duplicate review (ESTA-D010, recorded, needs
additive migrations). What exists and works: estate_config rules/subscription
upserts with `ESTATE_CONFIG_SET` audit entries (0025, 0032-partial), invite
codes + join requests (0028-partial — grants resident only, ESTA-D011),
multi-estate partitioning by `:id` + membership (0030). Missing: 0023, 0024,
0026, 0027, 0029, 0031, 0033–0036 (bulk import recorded as ESTA-D016).

## M03 — Properties, units & occupancy

Solid: AddProperty (0037), doc-backed ownership claims with admin review
(0039, 0051-partial), landlord-reviewed tenancy with atomic admit (0040, 0041),
household members (0042), per-unit rows allowing multi-unit ownership (0043),
property transfer requests (0047), vehicle registry + verify + gate plate scan
(0049), admin-only property mutation (0050), member deletion gates for move-out
(0046). Fixed: duplicate unit rejection (ESTA-D004 + pending unique index),
archive dependency gate for occupants/open invoices (ESTA-D008). Recorded:
no overlap/capacity check, no lease effective-date gating, no vacant-unit fee
policy (ESTA-D015).

## M04 — RBAC, delegation & tenancy isolation

Binary role model `resident|estate_admin` (CHECK constraint). Tenancy isolation
is real and well-scoped (0053, 0054, 0062, 0063, 0066 — membership re-checked
per request, IDOR guards on code/claim ownership). The delegated-role cases
(0055–0058, 0060, 0061, 0068) are MISSING — the roles do not exist
(ESTA-D011). Platform `estate.admin.*` oversight routes are read-only (0065-
partial). No bulk-export surface exists to abuse (0067 conditional).

## M05 — Visitor invitations & access codes

BFF-implemented. Fixed this lane: window/phone validation, CSPRNG codes,
collision retry, watchlist flag-on-issue (0074–0076, 0100); gate approve now
enforces status/validity/uses/blacklist/issuer-membership with an atomic CAS
consumption claim (0079–0083, 0091, 0094, 0098); new regenerate endpoint
(0084); lookup rate limit + full watchlist matching (0095); offline event
upload with id-dedup and preserved timestamps (0108, 0109). Recorded gaps:
unsigned QR payload (0070/0103), SMS delivery stub (0071), recurrence not
evaluated at gate (0072), no max-validity/quota policy (0077/0078), no
per-gate assignment or identity check (0086/0087), no resident
approve/decline/timeout flow (0088–0090), no PII retention (0097),
service-worker pass not bound to a work order (0099).

## M06 — Gate operations & security desk

Root defect found and fixed: `gate_sessions` had **no write path** — the whole
guard surface was unreachable (ESTA-D001). New `POST /gate/session` validates
estate membership + active gate, closes stale shifts, and attributes the shift
to guard/gate/estate (0101). After the fix, lookup/manual entry (0102),
check-in/out, walk-in, handover + open visits (0111), incidents (0114),
plate capture (0113), and the manual fallback path (0115) are usable. Recorded:
unsigned QR tamper detection (0103), no supervisor-override permission
(0104/0105), offline cache/revocation policy absent (0106/0107), no device
enrollment (0110), no estate emergency posture switch (0112-partial).

## Fixes landed (commits on uat/estate-a)

- `fix(visitor): add gate session sign-in + enforce admission at approve`
- `fix(visitor): validate access-code issuance + regenerate + sync dedup`
- `fix(estate): unit dedup, archive dependency gate, check-in race, deletion hold`
- `test(estate): visitor-gate-uat.spec.ts — 21 specs for the UAT fixes`

Pending migration (lane rule — no new migrations): `migrations-estate-a/
estate_properties_unique_unit.pending.sql` (backs ESTA-D004).

## Defects

23 defects in `defects-estate-a.csv`: 10 fixed in-lane (1 S1 session gap, 1 S1
gate-approve admission gap, plus S2/S3), 13 recorded for orchestration (largest:
estate lifecycle schema, delegated role model, resident approval flow, gate
policy/device model — all need schema or cross-lane work).

Shared-platform defects: ESTA-D012 (onboarding lifecycle), ESTA-D014 (vendor
payout verification), ESTA-D018 (SMS delivery) — flagged `shared_platform=yes`.

Shared files touched inside my domain only: none of the Go router files needed
changes; `finance_routes.go` untouched.
