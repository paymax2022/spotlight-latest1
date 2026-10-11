# Mobile app — simulated writes (mock-default + fake-success mutations)

**Date:** 2026-09-16 (rebased onto `main` 2026-10-11) · **Scope:** `mobile-app/reactnative/src/features/*` · **Trigger:** the same
defect `docs/audit/ADMIN_SIMULATED_WRITES.md` catalogued on the admin console, found independently
on the mobile side while hardening the Association module's API layer.

## The shape

A module's `USE_MOCK` (via `mockAllowed(envFlag, defaultWhenUnset)`, see
`src/config/mockPolicy.ts`) defaults to `true` even though its backend is live. Worse, several
modules' **mutation** functions fake a success response under mock instead of refusing — a
developer testing locally against a live backend sees fake "success" for writes that never
happened. `mockPolicy.ts`'s own contract says to pass `false` once a module's live endpoint
exists, "so a forgotten flag fails visibly against the real backend instead of inventing data" —
most modules never got flipped.

**CI gap, flagged not built:** `scripts/ci/check-simulated-writes.py` (the guard that now runs in
the `hygiene` CI lane) only scans `frontend-admin/src/services`. It does not look at
`mobile-app/reactnative` at all, so every instance below is currently invisible to CI. Extending
it to cover mobile is a real option but a separate, bigger decision (different file layout,
different module-per-file convention, ~26 modules to baseline) — not done here, left for an
explicit call.

## Full module inventory (`grep -rn "mockAllowed(" src/config/*.ts src/features/*/constants/*.ts src/features/*/api/*.ts`)

### Already correct (`defaultWhenUnset: false`), pre-existing
insurance, merchant, registration, voting.

### Fixed this pass (`false` + mutations converted to `notInFixtureMode` throws)
- **savings** (`src/features/savings/{constants,api}.ts`) — backend confirmed via
  `internal/savings/handler.go` route registration (all 9 mutation routes matched exactly) +
  `go test ./internal/savings/...` green + `npm run test:savings` (25/25) green. 9 mutations
  converted: createVault, fundVault, setAutoSave, earlyWithdraw, createCircle,
  contributeToCircle, joinCircle, createGroupTarget, contributeToTarget.
- **learn** (`src/features/learn/api/learn.api.ts`) — backend confirmed via
  `backend/tests/learn` green against live local DB + route match
  (`RegisterLearn` in `internal/learn/handler.go`; it was `routes.go` before the go-common refactor `44e3fb835`) + the frontend-web proxy
  (`frontend-web/app/api/v1/learn/[...path]/route.ts`) exists (the file's own comment was
  stale — it said the proxy was the "remaining dependency"; it shipped in `44af93146`). 1
  mutation converted: submitQuiz. Also removed the now-unused `QUIZ_PASS_RATIO` import (was
  only used by the deleted client-side mock-scoring branch).
- **meetings** (`src/features/meetings/{constants,api}.ts`) — no dedicated Go/test suite; verified
  by reading all 4 `frontend-web/app/api/v1/estate/meetings/**` route handlers (real Supabase
  queries against `estate_meetings`/`meeting_rsvps`/`meeting_minutes`) and confirming those tables
  exist in `supabase/migrations/` (`20260622010001_estate_modules.sql` +
  `20260623160000_estate_meetings_ext.sql`). 2 mutations converted: createMeeting, rsvpMeeting.

All three verified clean: `node --stack-size=10000 ./node_modules/typescript/bin/tsc --noEmit`
exit 0, 0 `error TS`, 0 `RangeError` (the stack-crash trap prints neither — see
`local-tsc-stack-crash` — checked explicitly, not inferred from exit code alone).

### Association — done and in `main`
Fully fixed (default flipped + all `src/features/association/api/*.ts` mutations converted to
`notInFixtureMode`) by commit `9e45713ed4` ("fix(association): stop mobile writes from faking
success in mock mode..."), now an ancestor of `main`. Use `src/features/association/api/admin.api.ts`
as the reference pattern.

- **Gotcha found by that session (ASSOC-BATCH3-VERIFY):** association is gated by TWO
  differently-named backend env vars — `FEATURE_ASSOCIATIONS_ENABLED` (plural, gates Go route
  registration) and `FEATURE_ASSOCIATION_ENABLED` (singular, gates the platform module-visibility
  registry the app queries at `/api/v1/modules/visibility` — see
  `src/features/modules/visibility.ts`). With only the plural one set, the API works but the app
  still shows a generic "Not available yet" screen. **Checked for savings/learn/meetings**: each has
  exactly one flag (`FEATURE_SAVINGS_ENABLED`, `FEATURE_LEARN_ENABLED`, `FEATURE_ESTATE_ENABLED`;
  `backend/internal/config/config.go` + `frontend-web/src/lib/feature-flags.ts`), so this specific
  split does not affect them — but check both the route-gating flag AND the module-visibility key
  for each module below before declaring one "live end-to-end."

### Still pending — not investigated this pass
creators, connect, election, events, health, crypto, fx (fx.api/fxAccount/fxCards/fxKyc — 4
files), visitor, loyalty, social, referral, investsettings, mobility (bus/mobility/event/towing/
parcel/carhire/scheduled/logistics/movers — 9 files, one module), admin (mobile-side, distinct
from frontend-admin), stays, crowdfunding (crowdfunding/investment/csr/crowdfundingExtras — 4
files), marketplace, investonboarding, investai, realtor, stocks, spotlightwealth.

Notes for whoever picks these up:
- **connect** is not a small module — 25+ sub-feature `api.ts` files (discovery, gamification,
  live, messaging, networking + assessments/content/jobs/mentorship/profile, profile, voting,
  wallet, plus a 755-line root `connect.api.ts`). Budget it as its own multi-session effort, not
  "one module."
- **crowdfunding**: the user flagged that it "already migrated years ago per its own code
  comments" — check `src/features/crowdfunding/api/*.ts` comments and git history before
  assuming it needs the same treatment; it may already be handled a different way (cf.
  frontend-admin's build-arg-gated fixture opt-in pattern, `f4d25e612`).
- **mobility**: each sub-file ORs its own flag with `EXPO_PUBLIC_MOBILITY_USE_MOCK` — check
  whether flipping the shared parent flag alone is enough or each needs its own default touched.
- General process for each: (1) confirm the backend endpoints exist and pass their own suite (Go
  `internal/<pkg>` unit tests, `backend/tests/<pkg>` live-DB suite with
  `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres`, or — where the
  module is served by frontend-web route handlers instead of Go, as meetings is — read the
  handler and confirm the underlying tables exist), (2) flip `defaultWhenUnset` to `false`, (3)
  convert every real mutation to `if (USE_MOCK) throw notInFixtureMode('...')` following
  `src/features/savings/api.ts` (or the sibling branch's `src/features/association/api/admin.api.ts`)
  as the template, (4) leave reads untouched, (5) run
  `node --stack-size=10000 ./node_modules/typescript/bin/tsc --noEmit` and check exit code AND
  `grep -c 'error TS'` AND `grep -c 'RangeError'` — don't trust exit code alone.
