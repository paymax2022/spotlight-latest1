# Mobile prod APK × www.spotlightng.com (cPanel) — API compatibility audit

Date: 2026-10-05. REPORT ONLY — no code changes.

## Headline verdict

**BROKEN (P0).** The production EAS profile bakes `EXPO_PUBLIC_API_BASE_URL=https://www.spotlightng.com`
(`mobile-app/reactnative/eas.json`, `build.production.env`), but the cPanel host runs a **stale
frontend-web build** that predates both the Go-BFF catch-all proxies and the `/api/auth/*` mobile
routes. Every `/api/v1/*`, `/api/finance/*`, `/api/v2/*`, `/api/auth/*` call returns a Next.js
**HTML 404 page**. Since login itself is `POST /api/auth/login`, **a fresh install cannot
authenticate at all** — the app is dead at the login screen. ~153 source files route through the
shared axios client on this base URL; ~339 distinct `/api/...` path literals exist in `src/`+`app/`.

The only thing that works unauthenticated is a handful of legacy Spotlight routes and pure-Supabase
reads for users who already hold a persisted session (refresh token → `supabase.auth.setSession`
goes direct to Supabase and still works).

## How the APK resolves its API host

- `src/lib/apiBaseUrl.ts` — `resolveApiBaseUrl()` reads `EXPO_PUBLIC_API_BASE_URL`; prod value is
  `https://www.spotlightng.com` (set deliberately per `docs/audit/agent4-notes.md` AUD-FE-001 fix).
- `src/api/client.ts` — shared axios instance, `baseURL = getDevUrl(resolveApiBaseUrl())`;
  `getDevUrl` is a no-op outside `__DEV__`. Attaches Supabase Bearer token; 401 → sign-out + login.
- `src/features/connect/constants/connect.constants.ts` — Connect builds an ABSOLUTE URL
  `${EXPO_PUBLIC_API_BASE_URL}/api/v1/connect` → also dead on www.
- `src/config/mockPolicy.ts` — `mockAllowed()` returns **false** when `EXPO_PUBLIC_APP_ENV` is
  `production` → no mock fallback; every module live-calls and fails visibly.

## Probe results — https://www.spotlightng.com (cPanel, live 2026-10-05)

"HTML 404" = Next.js `<!DOCTYPE html>` 404 page = route absent from that build.

| API path the APK calls | Method | cPanel result | Verdict |
|---|---|---|---|
| `/api/auth/login` | POST | 404 HTML | **dead — no login possible** |
| `/api/auth/register` | POST | 404 HTML | dead |
| `/api/auth/verify-otp`, `resend-otp`, `forgot-password`, `reset-password`, `otp-verify`, `me` | POST/GET | 404 HTML | dead (probed forgot/otp/verify/me) |
| `/api/v1/health`, `/api/v1/public/health` | GET | 404 HTML | dead (whole `/api/v1/*` family absent) |
| `/api/v1/wallet/balance`, `/api/v1/wallet/topup`, `/api/v1/virtual-accounts/me` | GET/POST | 404 HTML | dead |
| `/api/v1/transfers/{banks,paymax,resolve}`, `/api/v1/banks/resolve` | GET/POST | 404 HTML | dead |
| `/api/v1/contests/{id}/vote`, `/vote-packages` | GET/POST | 404 HTML | dead |
| `/api/v1/connect/*` (voting, supporters, votes/mine, notifications) | GET/POST | 404 HTML | dead |
| `/api/v1/crypto/*`, `/api/v1/stocks/*`, `/api/v1/invest/*`, `/api/v1/fx/*` | all | 404 HTML | dead |
| `/api/v1/{beneficiaries,me/tier,me/capabilities,onboarding/*,spotlight/*,learn/*,estate/*,stays/*,restaurant/*,marketplace,mobility,modules/visibility,referrals*,utility/*,notifications/push,kyc/*,elections,crowdfunding/*,doctor,telemedicine,...}` | all | 404 HTML | dead — entire Go-proxied surface (~300 paths) |
| `/api/finance/{health,kyc/me,kyc/initiate,wallet/balance,modules/access,events,savings,restaurant/*,mobility/*,property/*,academy,associations,business,social,loyalty,p2p/*,stays,health/*}` | all | 404 HTML | dead — entire `/api/finance/*` surface |
| `/api/v2/votes/paid/verify` | POST | 404 HTML | dead — paid-vote verification broken |
| `/api/votes/paid/wallet` | POST | 404 HTML | dead |
| `/api/votes/paid/initiate` | POST | **400 JSON** `contestId is required` (GET→405) | EXISTS — legacy Paystack initiate survives |
| `/api/registration/contests` | GET | **200 JSON** | exists |
| `/api/registration/applications` | POST | **401 JSON** | exists (auth-gated) |
| `/api/me/profile` | GET/PUT | **401 JSON** | exists |
| `/api/academy/*` | all | 404 HTML | dead |
| `/api/arena` | GET | 404 HTML | dead |
| `/api/media/banners/{slug}` | GET | 404 HTML | dead |
| `/api/realtor/*` (BFF paths) | all | 404 HTML | dead (realtor reads mostly Supabase-direct anyway — see below) |
| `/api/crowdfunding/uploads*` | POST | 404 HTML | dead |
| `/api/bills/catalog`, `/api/dashboard`, `/api/kyc/status`, `/api/contestants`, `/api/leaderboard`, `/api/health`, `/api/open-mic` | GET | 404 HTML | dead |

## Same probes against the Railway production frontend

`https://frontend-web-production-9259.up.railway.app` (the build `docs/e2e/results/prod-sweep*`
test against) — serves every family:

| Path | Result |
|---|---|
| `POST /api/auth/login` | 400 JSON `Email or phone number and password are required` — exists |
| `GET /api/v1/wallet/balance` | 503 `Wallet feature is not available` — route exists, backend FEATURE flag off |
| `GET /api/v1/{transfers/banks,crypto/assets,me/tier,estate/properties,learn/paths,onboarding/modules,spotlight/campaigns}` | 401 `Unauthorized` — proxied to Go, auth-gated → routes exist |
| `GET /api/finance/kyc/me` | 401 — proxied, exists |
| `POST /api/v2/votes/paid/verify` | 400 `Missing required field: paymentReference` — exists |
| `POST /api/votes/paid/wallet` | 503 `Wallet feature is not available` — exists |
| `GET /api/v1/{connect,crowdfunding,notifications/push}` | Go-side `404 page not found` — proxy works; those Go routes aren't registered/flagged in that env |
| Several modules (`beneficiaries`, `fx/rates`, `stays/extranet`, `utility/validate`, `referrals`) | 503 `feature not available` — Go feature flags off in that backend env |

## Supabase-direct flows (unaffected by the BFF outage)

`EXPO_PUBLIC_SUPABASE_URL/ANON_KEY` are set correctly in the prod profile
(`wnicsubiznmishkmunsv.supabase.co`). Pure-Supabase code paths (27 files import
`createSupabaseClient`):

- **Session restore**: `authStore` reads secure-storage tokens → `supabase.auth.setSession` —
  already-logged-in users keep working partially.
- **Realtime**: voting, marketplace, events, food-order, restaurant-queue, mobility trip tracking
  channel subscriptions.
- **Reads**: realtor listings/bookings/applications (`src/features/realtor/api/*`), profile
  (`user_profiles`), dashboard, transactions history (`utility_transactions`), wallet balance
  fallback (`wallet_balance` view, `src/api/wallet.api.ts:42-99`), registration lookups.
- Caveat: these only help users with a live session — **login/register/OTP are all BFF calls**, so
  new users and expired sessions are hard-blocked.

## eas.json profile check

| Profile | EXPO_PUBLIC_API_BASE_URL | OK? |
|---|---|---|
| development | unset (dev-client, localhost fallback) | dev-only, fine |
| preview | `frontend-web-staging-ec46.up.railway.app` | works (verified proxy live) |
| staging / staging-aab | `frontend-web-staging-ec46.up.railway.app` | works |
| **production** | `https://www.spotlightng.com` | **broken — stale cPanel build** |

No profile targets `frontend-web-production-9259.up.railway.app`. No code path points the APK at
the standalone `paymax/crypto-backend` trading service — crypto/stocks go through the same gateway.

## What the docs say vs reality

- `docs/devops/deployment-matrix.md`: prod `frontend-web` = **cPanel Passenger @ spotlightng.com**
  via `.github/workflows/deploy-cpanel.yml` on push to `main`.
- `docs/devops/DEPLOY-RUNBOOK.md` §4: mobile `EXPO_PUBLIC_API_BASE_URL` = "prod frontend-web
  origin" — so `www.spotlightng.com` is per-spec; the config is "right", the deploy is stale.
- `deploy-cpanel.yml` is gated on `vars.CPANEL_DEPLOY_ENABLED == 'true'` and its own header says it
  had been failing at `npm ci` since 2026-08-10 → cPanel has not received a current build (the
  Go-proxy catch-alls landed in commit `2dc12b7d`; the old build predates them AND the `/api/auth/*`
  mobile routes).
- Additional gap: even a fresh cPanel deploy does **not** provision `GO_BACKEND_URL` (Passenger
  env); `src/lib/go-backend.ts` defaults to `http://localhost:8080` → proxies would fail until the
  host env is set.

## Fix options (config only)

1. **Fastest — rebuild APK**: `eas build --profile production` with
   `EXPO_PUBLIC_API_BASE_URL=https://frontend-web-production-9259.up.railway.app` (verified serving
   all route families). EXPO_PUBLIC_* is baked at build time → requires a new binary/store
   submission. Caveats: backend FEATURE_* 503s for wallet/fx/stays/etc. and Go-404s for
   connect/crowdfunding/push in that env — those are backend-flag issues independent of this fix.
2. **Per-matrix — fix cPanel**: enable `CPANEL_DEPLOY_ENABLED`, deploy current frontend-web, AND
   set `GO_BACKEND_URL` (+ feature flags) in the Passenger env. Keeps the canonical domain; no APK
   change. Slower; also resurrects prod web to current code (a much bigger blast radius).
3. **DNS cutover**: point `www.spotlightng.com` at the Railway production frontend
   (`next.config.mjs` already carries the apex→www host-conditional redirect). Fixes web+APK at
   once, no rebuild — but is effectively the prod-web cutover decision.

## Evidence files / line refs

- `mobile-app/reactnative/eas.json` — production env block
- `mobile-app/reactnative/src/lib/apiBaseUrl.ts:13-27`, `src/api/client.ts:10`,
  `src/api/auth.api.ts:162,219` (login/register via `/api/auth/*`),
  `src/features/connect/constants/connect.constants.ts:31`,
  `src/config/mockPolicy.ts` (mockless prod)
- `frontend-web/app/api/v1/[...path]/route.ts`, `app/api/finance/[...path]/route.ts`,
  `frontend-web/src/lib/go-backend.ts:15` — proxies missing from cPanel build
- `frontend-web/next.config.mjs:150-172` — why rewrites were replaced by route handlers
- `.github/workflows/deploy-cpanel.yml` — `CPANEL_DEPLOY_ENABLED` gate + stale-build note
- `docs/devops/deployment-matrix.md`, `docs/devops/DEPLOY-RUNBOOK.md:69`,
  `docs/audit/agent4-notes.md` (AUD-FE-001)
