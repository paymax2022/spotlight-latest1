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

### Batch 5 (2026-10-12) — announcements; estate-family triage
- **announcements** (`src/features/announcements/api.ts`) — frontend-web handlers
  (`app/api/v1/estate/announcements/**`). Verified with `scripts/audit/verify_mobile_module.py`:
  **4/4 client calls match** (list, create, get, mark-read), real DB access, tables
  `estate_announcements`, `announcement_reads`, `estate_residents` and `user_profiles` exist; creating
  requires `estate_admin`, everything is residency-scoped, ids are UUID-checked. No automated suite
  for the handlers (code reading). 2 mutations converted (`markRead`, `createAnnouncement`); e2e pin
  added.
- **Tool:** `python3 scripts/audit/verify_mobile_module.py . <feature>` maps a module's client calls to
  frontend-web route files and checks the tables against migrations. Calls that only match the
  `app/api/v1/[...path]` catch-all are reported separately — a catch-all match is NOT proof a route
  exists, so check the Go side (caveats in its docstring).
- **Estate-family triage** (13 modules, one `api.ts` each, all `/api/v1/estate/<x>`):
  - **Clean — ready to flip, one module per PR:** documents (2 calls — done in Batch 6), dues (2 — done in Batch 7), emergencies (3 — done in Batch 8),
    repairs (4 — done in Batch 9), reports (2, read-only — done in Batch 10), tasks (3 — two handler files carry a
    "stub" comment, read them first), vendors (6), facilities (4). Every call matches a handler, every
    table exists, no read-side traps.
  - **Blocked — path mismatch, do not flip:** `ainotes` (1 of 4 calls matches; `GET
    /estate/ai-notes/:id`, `POST /estate/ai-notes/:id/approve`, `POST /estate/meetings/:id/ai-notes`
    have no web handler — Go serves `/api/finance/estate/:id/ai-notes/...`), `estateadmin` (1 of 9;
    the other 8 hit only the catch-all), `properties` (1 of 9; the web handler is only the list route),
    `estatesettings` (2 of 3; `DELETE /estate/account` hits only the catch-all). Go's estate routes
    live under `/api/finance/estate`, so these calls would 404 live. They need a client/proxy path
    reconciliation before any default can flip.

### Batch 6 (2026-10-15) — documents
- **documents** (`src/features/documents/api.ts`) — frontend-web handler
  (`app/api/v1/estate/documents`). `verify_mobile_module.py`: **2/2 client calls match** (list,
  create), real DB access, tables `estate_documents`, `estate_residents`, `user_profiles` exist.
  Server-side authz is correct: restricted documents are filtered out for non-admins on read, creating
  requires `estate_admin`, the file URL must be `http(s)://`. No automated suite for the handler (code
  reading). 1 mutation converted (`createDocument`); e2e pin added.

### Batch 7 (2026-10-15) — dues (money path)
- **dues** (`src/features/dues/api.ts`) — frontend-web handlers (`app/api/v1/estate/dues`).
  `verify_mobile_module.py`: **2/2 client calls match** (list, pay); tables `estate_dues_invoices` and
  `estate_payments` exist. Unlike the other estate modules this one **moves money, and it does it
  properly**: `payInvoice` (`frontend-web/src/server/estate/dues.ts`) requires an `Idempotency-Key`,
  checks residency + invoice ownership (404 for another estate's or another resident's invoice),
  validates the kobo amount, then debits the wallet through the shared `debitWallet` primitive (atomic
  RPC, fail-closed tier limits, balanced ledger posting, unique idempotency key) before recording the
  `estate_payments` receipt and marking the invoice paid. Replays return the prior payment without a
  second debit; a concurrent receipt insert (23505) is reconciled; failures after the debit surface as
  explicit 500s instead of silent divergence. **Covered by `frontend-web/tests/unit/estate/dues.money-path.spec.ts`**
  (idempotency, authz, kobo validation, status guards, happy path, replay, race, error surfacing).
  1 mutation converted (`payInvoice`); e2e pin added. The dues e2e only opens the payment sheet.

### Batch 8 (2026-10-15) — emergencies (safety-critical; two findings)
- **emergencies** (`src/features/emergencies/api.ts`) — frontend-web handlers
  (`app/api/v1/estate/emergencies`). `verify_mobile_module.py`: **3/3 client calls match** (list,
  report, resolve); table `estate_emergency_alerts` exists. No automated suite for the handlers (code
  reading). 2 mutations converted (`createEmergency`, `resolveEmergency`); e2e pin added (the e2e only
  opens the report screen). A faked "emergency sent" is the most dangerous thing a fixture can
  simulate, which is why this one matters.
  - **Finding 1 — the UI promises an alert that nothing sends.** `app/emergencies/report.tsx` says
    *"This immediately alerts estate security and admin"* and the hub card says *"Alert estate
    security & admin now"*. The live `POST /api/v1/estate/emergencies` only **inserts a row**
    (`status: 'open'`). There is no DB trigger, realtime channel, push or notification on
    `estate_emergency_alerts`, and the mobile screens neither subscribe nor poll — an alert is seen
    only by a resident who opens the list. Either the copy must change or real notification must be
    built; that is a product/safety decision, **still open**.
  - **Finding 2 — any resident can resolve any alert.** `POST /emergencies/:id/resolve` checks only
    that the caller is a resident of the same estate, so any resident can close another resident's
    open panic alert. **Product decision (2026-10-15): only the estate manager/admin
    (`estate_admin`) may resolve an alert.** **Fixed** in the follow-up PR (resolve restricted to estate admins).
    The resolve handler now returns 403 for any caller whose `estate_residents.role` is not `estate_admin`
    (before any write; same-estate and UUID checks kept; spec
    `frontend-web/tests/unit/estate/emergency-resolve-authz.spec.ts`), and the app hides the Resolve
    action unless the property context carries `estate_admin` on an estate
    (`src/features/emergencies/permissions.ts`), showing the server message if it is still refused.

### Batch 9 (2026-10-17) — repairs (one authorization finding)
- **repairs** (`src/features/repairs/api.ts`) — frontend-web handlers (`app/api/v1/estate/repairs`).
  `verify_mobile_module.py`: **4/4 client calls match** (list, create, detail, add-update); tables
  `estate_repair_requests` and `repair_updates` exist; no stubs, no read-side traps. No automated
  suite for the handlers (code reading). 2 mutations converted (`createRepair`, `addRepairUpdate`);
  e2e pin added (the e2e only reads fixtures).
  - **Finding — any resident can move any repair to any status.** `POST /repairs/:id/updates` checks
    only that the caller is a resident of the same estate, then writes the update and sets the
    request's `status` to whatever was sent (`reported`…`completed`, `reopened`, `cancelled`). The
    mobile detail screen (`app/repairs/[id].tsx`) shows the "Mark as <next status>" button to every
    resident. So a resident can mark a neighbour's open ticket `completed` or `cancelled`. Same class
    as the emergencies resolve finding (Batch 8), where the product decision was estate-admin only;
    **whether repair status changes should be estate-admin-only (reporter may reopen/cancel their
    own?) is not decided — open question, not changed in this PR.** (`cost_estimate_kobo` is
    display-only: no handler writes it.)

### Batch 10 (2026-10-17) — reports (read-only; default flip only)
- **reports** (`src/features/reports/api.ts`) — frontend-web handlers (`app/api/v1/estate/reports`,
  `app/api/v1/estate/analytics/[type]`). `verify_mobile_module.py`: **2/2 client calls match**; tables
  `estate_dues_invoices`, `estate_payments`, `estate_repair_requests`, `estate_meetings` exist; no
  stubs, no read-side traps, **no mutations** (nothing to convert to `notInFixtureMode`). Both
  handlers enforce `estate_admin` server-side (403 otherwise), and the server's analytics type list
  matches the client's 9. Default flipped to live; e2e pin added (the e2e renders the seeded
  sections). No handler tests (code reading).
  - **UX note, not changed:** a non-admin resident who opens Reports gets the generic "Couldn't load
    / Please try again" state with a Retry button — the server's 403 ("Only an estate admin can view
    reports") is swallowed. Retrying can never succeed for them. `getAnalytics` has no caller in the
    app today.

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
academy (+ academy/fees), admin (mobile-side), ainotes, aitrading, arena, connect,
creators (see Batch 3 — blocked), crowdfunding (4 files), crypto, estateadmin,
estatesettings, events, facilities, featured, finance, food, fractionalre, fx (4 files), health,
invest, investai, investonboarding, investsettings, marketplace, mobility (9 files + a hook,
one module), notifications, nutrition, properties, realtor, referral (2 files),
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
