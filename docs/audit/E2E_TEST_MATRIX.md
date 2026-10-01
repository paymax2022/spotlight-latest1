# E2E Test Audit — Live Stack Verification

Audit of the running application (frontend-web :3000 → Go backend :8095 → local Supabase
:54321/:54322) executed with Playwright 1.63 + Chrome 154, plus direct API probes with
real Bearer sessions. Separate from `FULL_AUDIT.md` — this file tracks **what was
actually exercised**, per module, with evidence.

- **Date:** 2026-10-01
- **Branch:** `main` @ `62e5d6ac` (post-merge of `refactor/go-common-cleanup`, PR #383)
- **Test account:** `qa-claude-test@spotlight.internal` (seeded fixture, verified via `scripts/dev/ensure-dev-login.sh`)
- **Method:** Playwright headless Chrome (channel `chrome`) + `curl` with Bearer tokens + PostgREST probes for DB verification

Legend: ✅ verified working · ⚠️ works with caveats · ❌ broken · ⬜ untested · 🚫 blocked (env/data)

---

## 1. Legacy Auth — READY ✅

| Check | Status | Evidence |
|---|---|---|
| Login (valid) | ✅ | `POST /api/auth/login` 200 → session cookie `sb-127-auth-token` + Bearer token in body |
| Login (bad password) | ✅ | 401 `invalid credentials` |
| Login (empty body) | ✅ | 400 `Email or phone number and password are required` |
| `GET /api/auth/me` authed | ✅ | 200 — real user, `kycStatus: verified` |
| `GET /api/auth/me` anonymous | ✅ | 401 — fails closed |
| Register (invalid payload) | ✅ | 400 validation |
| Forgot-password (unknown email) | ✅ | 200 generic message — no account enumeration |
| OTP verify (empty) | ✅ | 400 validation |
| Logout | ✅ | 200 `Logged out successfully` |
| Session persistence (UI login → dashboard) | ✅ | **re-verified post-F-9**: real form submit → `POST /api/auth/login` fires → redirect `/user-dashboard`; 79 hydrated interactive elements, client-side API calls (`/api/me`, `/api/opportunities`) firing |
| **Fresh registration end-to-end** | ✅ | `POST /api/auth/register` → 200 `needsVerification:true` → OTP email received in Mailpit ("Your Spotlight verification code") → `POST /api/auth/verify-otp` → `verified:true, signedIn:true` real JWT → login as new user 200 |
| Password reset end-to-end (Mailpit link) | ✅ | recover → Mailpit email → GoTrue `/verify` 303 → `#access_token&type=recovery` hash on `/` → inline script POSTs tokens to new `POST /api/auth/recovery-session` (204, cookies set) → redirect `/auth/reset-password` → form renders → `updateUser` → `/login` → GoTrue password grant with new password 200 (F-9, F-10 fixed) |
| Token refresh / expiry | ⬜ | not exercised |
| Rate limiting / lockout under attack | ⬜ | not exercised |

## 2. Contests — READY WITH RISKS ⚠️

| Check | Status | Evidence |
|---|---|---|
| `GET /api/v1/contests` | ✅ | 200, 3 live contests (ended correctly filtered out) |
| `GET /api/v1/contests/:id` | ✅ | 200 ×3 for all seeded contests |
| `GET` nonexistent contest | ✅ | clean 404 |
| `GET /api/v1/contests/categories` | ❌ | 500 — schema drift (see FINDINGS F-1) |
| `GET /contests/:id/contestants` | ⚠️ | 200 `[]` — reads `competition_enrollments` (empty), not seeded `contestants` |
| `GET /api/v1/contestants/:id` | ❌ | 404 — legacy contestant ids unresolvable (F-2) |
| `GET /contests/:id/leaderboard` | ✅ | 200 |
| `GET /contests/:id/vote-packages` | ✅ | 200, 5 packages (₦1k–₦50k tiers) |
| `GET /api/leaderboard/:contestId` | ⚠️ | 200 but `leaderboard: []` despite confirmed vote — joins enrollments (F-2) |
| `GET /api/registration/contests` | ✅ | 200 (earlier 500 resolved on restart) |
| `POST /api/contestants/:id/share` | ❌ | 500 — reads `competition_enrollments` (F-2) |

## 3. Voting — NOT READY ❌

| Check | Status | Evidence |
|---|---|---|
| `POST /api/votes/free` (real cast) | ✅ | `success:true, votesAdded:1`; `votes` row `confirmed`, `fraud_status:clean`; `vote_totals` +1 — verified in DB via service key |
| Daily free-vote limit | ✅ | 429 after limit — "used all 1 free votes … reset in 24h", fails closed |
| Concurrent same-key replay | ✅ | both rejected by limit check — no double-cast observed |
| `POST /api/votes/paid/initiate` (free contest) | ✅ | 400 "Paid voting is not enabled" — correct gate |
| `POST /api/votes/paid/wallet` (free contest) | ✅ | 400 — same gate |
| Input validation | ✅ | `voterEmail`/`packageId` required — 400s |
| `GET /api/votes/remaining` | ✅ | 200 — `freeVotesRemaining` accurate |
| `/api/vote-page` (the public vote page) | ❌ | **404 for every contestant** — queries `competition_enrollments.contest_id`; real column is `competition_id` (F-1) |
| `GET /api/contestant/votes/summary|timeline` | ❌ | same `contest_id` bug (F-1) |
| `/api/votes/stream` (SSE v1) | ✅ | 200 `text/event-stream`, keep-alive |
| `/api/v2/votes/stream` (SSE v2 gated) | ✅ | 200 `text/event-stream`, `x-accel-buffering:no` |
| Free vote as brand-new user | ✅ | fresh account cast on different contestant → `vote_totals` row created (1 vote each) |
| `/api/open-mic/votes` validation | ✅ | requires contestId/submissionId/source; paid needs paymentReference; votes>0 & ≤10000 |
| Open-mic vote end-to-end | 🚫 | `/api/open-mic/contests` returns empty — no seeded open-mic contests |
| Paid vote end-to-end (Paystack) | 🚫 | no paid-type contest seeded + no Paystack key locally |
| Wallet-paid vote end-to-end | 🚫 | same |
| `castFreeVote` TOCTOU race (vote-bridge doc) | ⬜ | needs concurrent same-day-limit bypass attempt; unverified |
| `verifyAndCreditPaidVote` FOR UPDATE gap | 🚫 | needs paid contest + webhook simulation |
| Elections (`/api/v1/elections*`) | ⚠️ | auth-gates correct, list 200 `[]` — zero seeded elections |

## 4. Applicants / Registration — READY WITH RISKS ⚠️

| Check | Status | Evidence |
|---|---|---|
| `GET /api/registration/contests` | ✅ | 200 |
| `GET /api/registration/applications` (authed) | ✅ | 200 `{success, applications}` |
| Anonymous applications/for-contest | ✅ | 401 fail-closed |
| `for-contest` missing param | ✅ | 400 `contestId or contestSlug is required` |
| `POST /applications` (empty) | ✅ | 400 validation |
| `/register` public form | ❌ | **frontend-only stub** — page header literally says "Frontend form only for now. TODO: Connect this payload to the registration backend endpoint when finalized." No API call fires on submit (F-8) |
| Full application submit + payment flow | 🚫 | needs multi-step form drive + payment rail |
| `/api/stem/contests` | ❌ | 500 — `stem_contests.description`/`created_by` not in schema (F-1) |
| `/api/open-mic/contests` | ✅ | 200 |

## 5. Wallet / Finance — READY ✅

| Check | Status | Evidence |
|---|---|---|
| `GET /api/finance/wallet/balance` | ✅ | 200 — ₦499,900 seeded |
| `GET /api/finance/wallet/transactions` | ✅ | 200 — real ledger rows |
| Dashboard wallet widget | ✅ | renders amounts |
| Top-up end-to-end | 🚫 | frontend calls `api.paystack.co` directly; no key locally |
| Transfers (PIN/bank) | ⬜ | not exercised — needs PIN setup flow |
| `GET /api/finance/business/me` | ✅ | route live after `FEATURE_BUSINESS_REGISTRY_ENABLED=true` |

## 6. Feature Modules (flag-gated) — READY ✅

| Module | Status | Evidence |
|---|---|---|
| Utility bills | ✅ | categories/billers/products/transactions all 200; UI shows real billers (MTN, Airtel, Glo, 9mobile). Payment blocked: vtpass unconfigured |
| Restaurant | ✅ | list + orders + checkout 200 |
| Crowdfunding | ✅ | campaigns + categories + contributions + create 200 |
| Referrals (`/earn`) | ✅ | dashboard/referrals/milestones/earnings — 4 endpoints 200 |
| Open Mic | ✅ | profile, dashboard, contests list — 200 |
| Film Academy | ✅ | dashboard + apply — 200 |
| Academy compliance/analytics pages | ❌ | pages render but call `/api/compliance/*` + `/api/academy/mock-exams/analytics` — routes exist nowhere; `RegisterMockExamRoutes` never invoked (F-3) |
| Elections | ⬜ | no seed data |

## 7. Page surface — 69 pages

| Suite | Tested | 200 | Failed |
|---|---|---|---|
| Public | 40 | 39 | 1 (`/vote-link` — API-only dir) |
| Authenticated | 19 | 19 | 0 |
| Apply/service-details | 10 | 10 | 0 |

- Avg load ~0.95s (dev server). **Zero JS page errors** across all 69.
- Console errors: 17 — all downstream of failed API calls listed above.

---

## Findings

| ID | Severity | Module | Defect | Root cause |
|---|---|---|---|---|
| F-1 | HIGH | voting/stem | `contest_id` vs `competition_id` on `competition_enrollments` (`vote-page`, `votes/timeline`, `votes/summary`); `stem_contests.description`/`created_by` selected but never migrated | code–schema drift; columns never existed per migrations |
| F-2 | HIGH | voting | two data worlds: seed data in legacy `contestants`; all new routes read empty `competition_enrollments` | no bridge/migration from legacy table |
| F-3 | MED | academy | `/api/compliance/*` (6 endpoints) + `/api/academy/mock-exams/analytics` called by pages but never implemented/mounted | orphan frontend surface |
| F-4 | MED | voting | `/api/leaderboard/:id` returns empty despite confirmed votes | joins enrollments (F-2) |
| F-5 | MED | contests | `/api/v1/contests/categories` 500 | local schema gap |
| F-6 | LOW | voting | `/api/votes/paid/wallet` timed out once (>30s) unauthenticated | flaky — responded normally after; needs repro |
| F-7 | LOW | info | `/vote-link` page 404; `/api/v1/contestants/:id` 404 for legacy ids | expected under new schema |
| F-8 | MED | applicants | `/register` public form is a frontend-only stub — never calls any API ("TODO: Connect this payload to the registration backend endpoint") | feature incomplete — form doesn't submit |
| F-9 | HIGH (dev) | infra | **Zero client-side hydration in dev** — Turbopack dev waits for `/_next/hmr` WS before hydrating; Next 16 blocks it as "cross-origin request … from 127.0.0.1". Every click/JS interaction was dead locally (login button, reset page). **FIXED**: `allowedDevOrigins: ['127.0.0.1']` in `next.config.mjs` + `/_next/hmr` added to middleware matcher exclusions | config, post-Next-16-upgrade |
| F-10 | HIGH | auth | **Password reset broken by `@supabase/ssr@0.12.7`** — `createBrowserClient` hardcodes `flowType:'pkce'` (option non-overridable); local GoTrue `/verify?type=recovery` issues *implicit* `#access_token` hashes (ignores `redirect_to` in URL, always bounces to site root). PKCE client throws `Not a valid PKCE flow url` → silent no-event/no-session → reset page stuck. **FIXED**: inline `<head>` script in `app/layout.js` posts hash tokens to new `POST /api/auth/recovery-session` (server `setSession` → cookies) then lands on `/auth/reset-password`; page's `getSession()` fallback renders the form | dependency bump vs implicit email links |

## Fixes landed during testing (code, committed-pending)

| File | Change | Why |
|---|---|---|
| `frontend-web/next.config.mjs` | `allowedDevOrigins: ['127.0.0.1']` | F-9 — restores `/_next/hmr` → hydration in dev |
| `frontend-web/middleware.ts` | matcher excludes `/_next/hmr`, `/_next/webpack-hmr`, `/_next/turbopack-hmr` | F-9 — middleware was intercepting the dev socket |
| `frontend-web/app/layout.js` | inline `<head>` script: on `#…type=recovery` POST tokens to recovery-session → replace to reset page | F-10 — bypasses PKCE-only client for implicit hashes |
| `frontend-web/app/api/auth/recovery-session/route.ts` (new) | `POST {access_token, refresh_token}` → server `supabase.auth.setSession` → 204 | F-10 — converts implicit hash into cookie session |

⚠️ **Re-baseline note:** all earlier "interactive" results predate the F-9 hydration fix — pages rendered via SSR but no client JS ran. Click/hydration-dependent behaviour must be re-verified.

## Env fixes applied during testing (local only, gitignored)

- `frontend-web/.env.local`: +23 `FEATURE_*` flags → utility/restaurant/crowdfunding 503→200
- `backend/.env`: `FEATURE_UTILITY_BILLS_ENABLED`, `FEATURE_BUSINESS_REGISTRY_ENABLED` → routes mounted

## Blocked test paths

| Path | Blocker |
|---|---|
| Paid voting (Paystack + wallet) | no paid-type contest seeded; no Paystack key |
| Vote-page slug resolution | F-1 — needs code fix or seed enrollments with matching column |
| Elections | zero seeded data |
| STEM contests list | F-1 schema drift |
| Registration submit → payment | needs full form drive + rails |
| ~~Password reset~~ | ✅ RESOLVED — full flow verified end-to-end |
| `/register` form submit | F-8 — form is a stub, never calls API |

## Production verdict

- Auth, wallet, referrals, utility, restaurant, crowdfunding, open-mic, film-academy — **READY**
- Voting — **NOT READY**: engine writes correctly but discovery surface (vote page, leaderboard, contestant detail, share) is dead under F-1/F-2
- STEM contests, academy compliance/analytics — **NOT READY**: F-1/F-3
- Elections — **UNVERIFIED** (no data)
