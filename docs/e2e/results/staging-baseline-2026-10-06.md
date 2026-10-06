# Staging → Production Readiness Validation — 2026-10-06

Method: live HTTP probes against Railway deployments + the `staging-inspect`
workflow (read-only Railway/Supabase introspection; env VALUES never printed —
names, hosts, lengths, sha256 prefixes only). Every claim below was verified by
real requests, not config inspection.

## Staging status: READY (with noted unverified items)

Railway project `e7dca861`, environment `staging`, Supabase
`wnicsubiznmishkmunsv.supabase.co`.

| Service | Domain | State |
|---|---|---|
| frontend-web | frontend-web-staging-ec46.up.railway.app | Next.js serving (repaired) |
| frontend-admin | frontend-admin-staging-ade6.up.railway.app | Next.js serving (repaired) |
| backend | backend-staging-d9bb.up.railway.app | Go/Gin, all modules registered |

### Staging E2E results (actual requests)

| Step | Result |
|---|---|
| `GET /`, `/login`, `/register` | 200, Next.js HTML (was Gin 404 before repair) |
| `POST /api/auth/register` (fresh account) | 200, `needsVerification:true` — full BFF→Go→GoTrue chain |
| Wrong OTP | 400 `{"error":"invalid code"}` — correct rejection |
| Resend OTP | 200 generic message |
| Login before verification | 403 `email_not_confirmed` — gate enforced |
| Confirmed-user `POST /api/auth/login` via BFF | 200 + session JWT (minted throwaway user, deleted after) |
| `/api/finance/restaurant` (all sort variants, `/mine`) | 200 |
| `/api/finance/associations` | 200 |
| `/api/v1/marketplace/my-listings` | 200 |
| `/api/finance/wallet/balance` | 200 `{balance_kobo:0}` — **pgx money path live** |
| `/api/registration/contests`, `/api/v1/contests` | 200 real contest data |
| `POST /api/v2/votes/free` (seeded contestant) | **200, votesAdded:1** — real vote through bridge |
| Same `X-Idempotency-Key` replay | 429 "used all 1 free votes today" — see findings |
| Cleanup: votes/limits/totals/contestant/settings + user | 5×204 + user deleted |

### Staging repair performed (was a hard blocker)

Both UI services had `rootDirectory: null` → `dockerfilePath: "/Dockerfile"` →
built the repo-root Go image. Every web page answered with Gin's
`404 page not found`. Fixed via `serviceInstanceUpdate` GraphQL mutation
(`Project-Access-Token` header — project tokens do not accept
`Authorization: Bearer`), then a rebuild triggered by empty main commit
`3d02cbb2` (staging auto-deploys on main; prod deploys are CLI-triggered).

### Unverified on staging

- Actual OTP/confirmation **email receipt** (Supabase mailer/SMTP owner config)
- Paystack top-up + webhook round-trip (secret present, flow not run)
- Redis-dependent paths — `REDIS_URL` is **NOT SET** on staging backend
  (idempotency cache, Redlock, asynq degraded/absent)
- Worker/queue processing (no asynq instance observed)

## Production status: BLOCKED

Supabase `nmseefdlliejmdbxytej.supabase.co` (different project — expected).
Frontend on commit `bda0ef5c`, serving Next.js correctly.

### Prod probe results (actual requests, same battery as staging)

| Step | Result |
|---|---|
| `GET /`, `/login`, `/register` | 200 Next.js HTML |
| BFF login (minted confirmed user) | 200 + JWT |
| `/api/registration/contests`, `/api/v1/contests` | 200 real data |
| `POST /api/v2/votes/free` (seeded) | 200 votesAdded:1 |
| **`/api/finance/restaurant*`, `/mine`, wallet/balance, marketplace** | **Gin 404 — routes not mounted** |
| `/api/finance/associations` | 503 "module is not available" |
| `POST /api/auth/register` | **intermittent 400** — see F1 |
| Login unverified / resend-otp | 403 `email_not_confirmed` / 200 — correct |

### Findings

- **F1 — register intermittently 400 (environment/config).**
  `RegisterUser` calls GoTrue `/auth/v1/signup` when OTP is not operational
  (needs `FEATURE_OTP_EMAIL_ENABLED` + pgx pool + `OTP_PEPPER` + `BREVO_*`).
  Any GoTrue ≥400 becomes one generic 400. Observed: one gmail signup
  succeeded (user `dee50fea…` created, unverified-login gate works), then all
  subsequent attempts — any domain, any payload shape — 400. Signature fits
  GoTrue's built-in per-IP `sign_in_sign_ups` budget: **every prod signup
  egresses from the same Railway IP, so all users share one ~30/hour quota.**
  Needs backend log line `registration failed: <status>` to confirm
  (429 = rate limit, 422/other = different cause). Inspect run 37436244003 is
  awaiting `production` environment approval.

- **F2 — finance/module 404s (environment).** `/api/finance/*` unmounted and
  associations 503 ⇒ prod pgx pool never came up ⇒ `DATABASE_URL` broken
  (known from earlier audit — password/pooler config) or absent. This ALSO
  disables the OTP service (requires pool), forcing register onto the
  rate-limited `/signup` path — the two findings are linked.

- **F3 — free-vote idempotency not enforced (confirmed app bug).**
  Replaying `POST /api/v2/votes/free` with the same `X-Idempotency-Key`
  returned 200 and **counted a second vote** (`totalFreeVotesUsed:2`) on prod
  (limit 3/day). On staging the same replay returned 429 only because the
  seeded limit was 1 — dedup did not fire there either. Replay must return the
  cached result, not a new vote or a limit error.

- **F4 — `REDIS_URL` unset on staging backend (env gap).** If also unset on
  prod, idempotency/locks/queues have no shared store — likely related to F3.

## Staging vs production difference matrix

| Area | Staging | Production | Delta |
|---|---|---|---|
| App commit | `3d02cbb2` (main HEAD) | `bda0ef5c` (prod branch) | different code trains |
| Supabase project | `wnicsubiznmishkmunsv` | `nmseefdlliejmdbxytej` | expected |
| Frontend serving | Next.js (after repair) | Next.js | parity |
| `DATABASE_URL`/pgx | pooler set, connects, finance routes live | finance routes unmounted → pool down | **prod broken** |
| OTP subsystem (`FEATURE_OTP_EMAIL_ENABLED`+Brevo+pepper+pool) | flag present; register reliable ⇒ admin path | register intermittent ⇒ `/signup` path + shared-IP budget | **prod broken/unconfigured** |
| `REDIS_URL` | NOT SET | unknown (needs approved inspect) | gap |
| `PAYSTACK_SECRET_KEY` | set (fe+be) | earlier sweep: fe-only | partial |
| `ADMIN_API_KEY`/`APP_ENV` | set / staging | earlier: set | likely parity |
| `MAPS_GOOGLE_KEY`/`FEATURE_MAPS_ENABLED` | set/true | earlier: not set | staging richer |
| Migrations | current (vote chain works) | ~170 behind (issue #493, incl. `otp_codes`) | **prod drift** |

## Staging baseline (what prod must match)

- Railway service `rootDirectory` = `frontend-web` / `frontend-admin` /
  `backend` respectively (staging UI services lost this once — guard it)
- Working `DATABASE_URL` → pooler, verified by live `pgx` connect +
  `/api/finance/*` mounted
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` on backend pointing at the
  environment's own project
- Frontend: `GO_BACKEND_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `PAYSTACK_SECRET_KEY` (fe for topup init + be for verify)
- Registration path decision: either (a) enable OTP subsystem
  (`FEATURE_OTP_EMAIL_ENABLED` + `OTP_PEPPER` + `BREVO_API_KEY` +
  `BREVO_SENDER_EMAIL` + `BREVO_OTP_TEMPLATE_ID` + pool + `otp_codes`
  migration) so register uses `/admin/users` and bypasses GoTrue's
  shared-IP signup budget, or (b) accept `/signup` and raise/work around
  the per-IP quota on the Supabase project — (a) is the design the code
  already supports
- `REDIS_URL` for idempotency/locks/queues
- Supabase project: email provider enabled, signup allowed, migrations
  current
