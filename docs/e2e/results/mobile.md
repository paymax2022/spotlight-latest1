# MOBILE (React Native / Expo web) — live-backend E2E validation results

Date: 2026-10-03. Lane: `mobile-app/reactnative/tests/e2e-live/` (5 specs, all green on
`mobile-chrome` / Pixel 7 viewport). Config: `mobile-app/reactnative/playwright.live.config.ts`.
Run: `cd mobile-app/reactnative && npx playwright test --config playwright.live.config.ts`
(or `E2E_LIVE_BASE_URL=<app-url> npx playwright test -c playwright.live.config.ts`).

The existing suite (`tests/e2e`, 66 specs) is 100% route-mocked — it never produces
production evidence. This lane has **zero route stubs**: every call the app makes is
observed against a real listener, and statuses are asserted.

## Stack actually exercised

- **App**: Expo dev server `expo start --web --port 8083` (react-native-web bundle),
  `mobile-app/reactnative/.env` resolved by the bundle:
  - `EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3000` → **Next.js dev server** (`next-server
    v16.3.8`) hosts `/api/auth/*`, `/api/v1/*`, `/api/media/*`.
  - `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` → local GoTrue + PostgREST
    (reads go straight to Supabase — profile, wallet, transactions do NOT pass :3000).
  - `EXPO_PUBLIC_TRANSFERS_USE_MOCK=true`, `EXPO_PUBLIC_REALTOR_USE_MOCK=true` — the
    running bundle still has these mock toggles on (see "Limitations").
- **Auth plane**: `POST :3000/api/auth/login` (Next proxy → GoTrue) returns the real
  session; the app adopts it via `supabase.auth.setSession()` and persists it under
  `paymax_secure_sb-127-auth-token` in localStorage (web shim of expo-secure-store,
  `src/lib/secureStorage.ts`).
- **Go backend :8080 — NOT exercised.** The RN app has no code path that calls it;
  its API plane is :3000 + :54321. Coverage maps should mark :8080 as untouched by
  mobile journeys in this configuration (finding F1).
- **Mailpit :54324 — not exercised** (no email leg in these five journeys).

Environment facts verified live:
- Fixture `qa-claude-test@spotlight.internal` / `LocalDevAdmin123!` works against
  `POST :3000/api/auth/login` → 200 real JWT. No repair needed; `ensure-dev-login.sh`
  was NOT run. `admin@spotlight.internal` untested by this lane.
- Fixture is **KYC tier 0** (`user_profiles.kyc_status='unverified'`) and its
  `wallet_balance` row is `user_wallet / available_kobo=0` → rendered "₦0.00".
- `GET :3000/api/v1/wallet/balance` answers **403** for this fixture:
  `"This feature requires KYC Tier 1. Your current tier is 0."` — the app's documented
  fallback to the `wallet_balance` PostgREST view is what produced the balance.
- `GET :3000/api/v1/modules/visibility` → 200, 34 modules including `wallet`,
  `utilityPayments`, `events` → the home "Explore Services" grid renders unstubbed.

## Verdicts

| ID | Journey | Verdict |
|----|---------|---------|
| MOB-001 | Real UI login → authenticated home | **PASS** — 200 login, real session persisted, live profile greeting |
| MOB-002 | Session persistence across reload | **PASS** — zero re-login POSTs; GoTrue user reads 200 post-reload |
| MOB-003 | Live data flow (dashboard wallet/profile/activity) | **PASS** — all reads hit live PostgREST/Next; wallet primary 403→fallback 200 verified |
| MOB-004 | Unauthenticated deep-link → bounced to login | **PASS** — `/home` → `/login`, no session, no authed reads |
| MOB-005 | Invalid credentials → error state | **PASS** — live 401, exact INVALID_CREDENTIALS copy shown |

5/5 specs pass in ~16s total (serial, `workers:1`).

## Per-journey evidence (observed network)

### MOB-001 — login through the real UI
`/login` → fill identifier/password → "Sign In".
- `POST 127.0.0.1:3000/api/auth/login` → **200** (real session body)
- localStorage `paymax_secure_sb-127-auth-token` contains `access_token`/`refresh_token`
- `GET :54321/auth/v1/user` → 200; `GET :54321/rest/v1/user_profiles` → 200
- Home renders `Explore Services` + **`Hello, QA`** — the greeting is derived from
  the live `user_profiles.full_name='QA Claude Test'`, so a stubbed profile could
  not produce it.

### MOB-002 — persistence across reload
Login → `page.reload()` → still on home, `Hello, QA` visible, URL not `/login`.
Post-reload window contained **0** `POST /api/auth/login` calls and 200s on
`auth/v1/user` — the persisted session was restored, not re-authenticated.
(Refresh-token grant was not needed — session still in its 1h validity window;
rotation is covered for web in `auth.md` AUTH-004.)

### MOB-003 — live data flow (home dashboard)
All of the following were observed as real responses:
- `GET :54321/auth/v1/user` → 200 (dashboard's fatal auth check)
- `GET :54321/rest/v1/user_profiles` → 200 (greeting source)
- `GET :3000/api/v1/wallet/balance` → **403** (live KYC gate — `kyc_status` verified)
- `GET :54321/rest/v1/wallet_balance?account_type=in.(user_wallet,wallet)&currency=eq.NGN` → 200
  (fallback that produced the rendered balance)
- `HEAD :54321/rest/v1/ledger_entries` → 200 and
  `GET :54321/rest/v1/mobile_fintech_accounts` → 200 (secondary balance legs)
- `GET :54321/rest/v1/utility_transactions?…&limit=5` → 200 (recent activity — the
  fixture has 1 real row)
- `GET :3000/api/media/banners/home-hero`, `…/home-featured-services` → 200
- Rendered: `Total Balance`, `Hello, QA`, `Explore Services`.

### MOB-004 — unauthenticated bounce
Fresh context → `GET /home` → `Welcome back` + `Sign In` on `/login`; storage key
absent; **0** successful authenticated reads. AuthGate redirect verified live.

### MOB-005 — invalid credentials
Wrong password → `POST :3000/api/auth/login` → **401** (live proxy verdict) →
UI shows exactly `Incorrect email/phone number or password. Please try again.`;
stays on `/login`, no session persisted.

## Findings

- **F1 (INFO / coverage)** — The Go backend on :8080 is invisible to the RN app.
  `src/api/client.ts` bases axios on `EXPO_PUBLIC_API_BASE_URL` → :3000, and all
  reads go to PostgREST :54321. Every "backend api :8080" assumption in test
  planning does not apply to mobile; the mobile API plane is Next.js + Supabase.
- **F2 (INFO / env)** — `GET /api/v1/wallet/balance` is KYC-gated (403 at tier 0)
  and the client silently falls back to the `wallet_balance` view. For this
  fixture the rendered ₦0.00 came from the fallback, not the money-path API —
  both are real, but a future live money-flow spec should use a Tier-1+ fixture
  so the primary leg is exercised end-to-end.
- **F3 (LOW)** — `MOB-005` performs one real failed login per run, incrementing
  `platform_users.failed_login_attempts` on the shared fixture. One attempt is
  far below lockout; if the lane is ever looped heavily, run
  `scripts/dev/ensure-dev-login.sh` afterwards (it clears the counter — do not
  hand-edit the password).
- **F4 (INCIDENT)** — The orchestrator-owned Expo server (PID 31914, up since
  ~04:21) died during the first test run — all 5 specs hit
  `ERR_CONNECTION_REFUSED` on :8083 (cold-Metro bundle compiles under browser
  load is the likely trigger; no crash log found). It was restarted **identically**
  — `npm run web` from `mobile-app/reactnative`, same `.env`-loaded
  `EXPO_PUBLIC_*` set (confirmed in startup log). If the orchestrator needs it
  down at a specific lifecycle point, it should be reaped there. Second run:
  5/5 green.
- **F5 (LOW / pre-existing)** — `.env` still carries
  `EXPO_PUBLIC_TRANSFERS_USE_MOCK=true` + `EXPO_PUBLIC_REALTOR_USE_MOCK=true` in
  the "live" dev profile, so any future live transfer/realtor spec must override
  them via env at server start (documented in `.env` comments) — the PIN gate
  (`getPinStatus`) reads `localStorage['paymax_mock_txn_pin']` in this mode.
  `/home` is not a money route, so MOB-001..003 are unaffected.

## What remains native-only (Expo-web boundary — not blocked, untested here)

- **expo-secure-store** — web falls back to `localStorage` (`src/lib/secureStorage.ts`);
  real SecureStore encryption on iOS/Android is unverifiable from this lane.
- **Push notifications** (`usePushNotifications`, visitor/election bridges) —
  `expo-notifications` is a no-op/web-limited; deep-link routing untested.
- **Camera/QR** (`expo-camera` visitor gate), **biometrics**, `Alert.prompt`
  (iOS-only input) — no web equivalent exercised.
- **Secure PIN entry screens** (`/security/set-pin`, money routes) — gated by the
  transfers mock flag noted in F5; not covered in this bounded lane.
- **App-store build config** — `eas.json` profiles vs `.env` drift is out of scope;
  `resolveApiBaseUrl` only fails loudly in non-dev builds, so a missing
  `EXPO_PUBLIC_API_BASE_URL` in a dev web bundle still silently falls back to
  `localhost:3000`.

## Endpoint coverage (this lane)

| Endpoint | Calls | Statuses |
|---|---|---|
| `POST :3000/api/auth/login` | per-spec | 200 (good creds), 401 (bad) |
| `GET :3000/api/v1/modules/visibility` | boot | 200 |
| `GET :3000/api/v1/wallet/balance` | home | 403 (KYC Tier-1 gate) |
| `GET :3000/api/media/banners/{home-hero,home-featured-services}` | home | 200 |
| `GET :54321/auth/v1/user` | session checks | 200 |
| `GET :54321/rest/v1/user_profiles` | profile | 200 |
| `GET :54321/rest/v1/wallet_balance` | wallet fallback | 200 |
| `HEAD :54321/rest/v1/ledger_entries` | balance leg | 200 |
| `GET :54321/rest/v1/mobile_fintech_accounts` | balance leg | 200 |
| `GET :54321/rest/v1/utility_transactions` | recent activity | 200 |
| `:8080/*` | — | **0 calls (not in the app's call path — F1)** |
| `:54324` (Mailpit) | — | 0 (no email leg) |
