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

### Batch 2 (2026-10-11) — loyalty
- **loyalty** (`src/features/loyalty/{constants,api,black}.ts`) — all 7 member routes present
  (`/me` in `internal/loyalty/service.go`; `/points/{balance,catalog,redeem}` in
  `internal/points/service.go`; `/black/{me,perks,redeem}` in `internal/loyalty/black.go`);
  `go test ./internal/loyalty ./internal/points` green; the live-DB redeem suites ran green in
  `main`'s last completed `integration-verify` (anti-skip canary passed). 2 mutations converted:
  `redeem` (points) and `redeemPerk` (Black). **Deliberately not converted:** `upgradeToBlack` —
  enrolment is admin-only (`BlackHandler.AdminEnroll`), there is no member endpoint, and it
  already refuses in live mode. Single flag (`FEATURE_LOYALTY_ENABLED`), no two-flag split.

### Batch 3 (2026-10-11) — election; creators deferred
- **election** (`src/features/election/{constants,api}`) — served by frontend-web route handlers
  (`app/api/v1/elections/**`, same pattern as meetings). **No automated test suite exists** for them;
  verified by reading the handlers (real `estate_admin` authz, closed-election and
  one-candidate checks) and confirming `elections`, `election_candidates`, `election_votes` and
  `estate_residents` exist in `supabase/migrations/20260616250000_estate.sql`. Gated by
  `FEATURE_ESTATE_ENABLED` (shared with meetings; no second flag). 3 mutations converted:
  `castVote`, `createElection`, `publishResults`. `EXPO_PUBLIC_ELECTION_USE_MOCK` is also pinned
  `true` in `playwright.config.ts`: the active-election query runs app-wide (root push bridge),
  so e2e must keep the fixture baseline. Note the mobile client talks to a *single-position* DB
  schema (the handler synthesises one `${id}:main` position) — a product limitation, not changed.
- **creators — NOT flipped; backend is only half there.** All 7 mutations have live routes
  (`internal/creators/handler.go`: apply, tip, content, purchase, subscribe, cancel, payouts), but
  the client's read side is not live-ready:
  1. `listCreators`, `listMyContent`, `listSubscriptions` return `[]` in live mode with a stale
     "MISSING BACKEND ENDPOINT" comment — the backend has since added `GET /creators-directory`,
     `GET /my-creator/content`, `GET /my-creator/subscriptions`; the client was never wired to them.
  2. `getStorefront` in live mode maps the real profile but **fills tiers, content and
     `isSubscribed` from mock data** (the storefront endpoint returns only `profile`; there is no
     tier-listing or per-creator content-listing endpoint). That shows invented tier ids a user
     could try to subscribe to.
  3. `completePayoutKyc` has no member endpoint at all (already refuses in live mode).
  Flipping the default would blank Discover/My content/Subscriptions and leave a fake storefront.
  To finish: wire the 3 list reads (response shapes: `{creators}`, `{content}`, `{subscriptions}`),
  add a tiers + content read to the backend, then flip and convert the 7 writes. This is a money
  module (tips, subscriptions, payouts) — have `ledger-auditor` review.

### Batch 4 (2026-10-11) — visitor; social deferred
- **visitor** (`src/features/visitor/{constants,api}`) — served by frontend-web route handlers
  (`app/api/v1/visitor/**`). **No automated test suite exists** for them. Verified by mapping every
  client call to a handler: **all 40 calls (method + path) have a matching route file**, every
  handler does real Supabase work, and the nine tables they query (`visitor_access_codes`,
  `visitor_gate_events`, `gate_sessions`, `visitor_blacklist`, `visitor_incidents`,
  `visitor_notifications`, `estate_residents`, `estates`, `user_profiles`) exist in
  `supabase/migrations`. The two stub handlers (`codes/:id/share` is intentionally client-rendered;
  `gate/vehicles/scan` is a stub ANPR route) are not among the 40 calls. No feature flag gates the
  handlers and there is no `visitor` module-visibility key. 20 mutations converted
  (createAccessCode, revoke/extend, logShare, syncPendingLogs, approve/denyEntry,
  recordArrival/Exit, checkOutVisit, createWalkIn, submitHandover, mark(All)NotificationsRead,
  add/removeBlacklist, submitIncident, createEventGuestCodes, submitProofOfPayment, submitAppeal).
  `EXPO_PUBLIC_VISITOR_USE_MOCK` is also pinned `true` in `playwright.config.ts` (the visitor push
  bridge runs app-wide).
  - **Pre-existing gap found (not changed here): the hard-ban payment restriction is enforced
    only in the UI.** The fixture `createAccessCode` used to fail closed on
    `restriction.state === 'hard_ban'` (VM-108/VM-301), but in live mode the only check is the
    create screen disabling the button (`app/visitor/create.tsx`). Server-side,
    `POST /api/v1/visitor/codes` validates residency, name and window but never reads
    `payment_standing`, so a hard-banned resident can still create codes by calling the API.
    `GET /restriction` shows the data is there. Needs a server-side check in the handler.
- **social — NOT flipped; the read side is partly missing.** All writes have live routes
  (`internal/social/handler.go`), and since the client comments were written the backend added
  `GET /activity`, `GET /splits` (list), `GET /pools` (list) and `GET /requests` — the client still
  returns `[]` for activity, splits and pools behind stale "MISSING BACKEND ENDPOINT" comments.
  Still genuinely missing: a contacts directory, cashtag search, an escrow orders/trades list and a
  spray-target read (`escrow.ts` / `spray.ts`). Flipping now would blank those screens. To finish:
  wire the four existing list reads, add the missing endpoints (or drop the screens), then flip and
  convert the writes. It is a money module (send/request, splits, pools, escrow, spray) — have
  `ledger-auditor` review.

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

### Done by other sessions (already `false` on `main`)
kycverify, property, restaurantmerchant, stayshotelier.

### Still pending — full list from a fresh scan of `main` (2026-10-11)
`grep -rn "mockAllowed(" src` — everything still passing `true`, by feature folder:
academy (+ academy/fees), admin (mobile-side), ainotes, aitrading, announcements, arena, connect,
creators (see Batch 3 — blocked), crowdfunding (4 files), crypto, documents, dues, emergencies, estateadmin,
estatesettings, events, facilities, featured, finance, food, fractionalre, fx (4 files), health,
invest, investai, investonboarding, investsettings, marketplace, mobility (9 files + a hook,
one module), notifications, nutrition, properties, realtor, referral (2 files), repairs, reports,
social (see Batch 4 — blocked), spotlightwealth, stays, stocks, tasks, transfers, vendors, plus
`src/api/doctor.client.ts` and `src/api/telemedicine.api.ts`.
(An earlier version of this list had ~26 names: it only scanned `constants/` and `api/`
sub-folders and missed modules whose flag lives in `api.ts` at the feature root.)

Treat the money-touching ones (finance, transfers, fx, crypto, stocks, invest) with extra care and
have `ledger-auditor` look at them.

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
- **e2e specs depend on the mock default.** `tests/e2e/modules/<module>.spec.ts` render the built-in
  fixtures with no endpoint mocks, and e2e is not run in CI, so flipping a default breaks them
  silently. When you flip a module, add `EXPO_PUBLIC_<MODULE>_USE_MOCK: 'true'` to the
  `webServer.env` block in `playwright.config.ts` (savings/learn/meetings/loyalty are pinned there)
  and update the spec's header comment. Run the module's spec before committing — under heavy
  machine load raise `expect.timeout` (default 10 s) with a throwaway `-c` config.
- **The mobile web bundle does not build on a fresh `npm ci` of `main`** (found 2026-10-11):
  `react-native-view-shot@6.1.1` (added for the association membership card) needs
  `html2canvas-pro@^2` on web, but `package.json` lists `html2canvas` instead. Until that is fixed,
  `npm ci && npm run web` fails to bundle; `npm install --no-save html2canvas-pro@^2` works around
  it locally. Playwright also needs `npx playwright install chromium` when its version moves.
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
