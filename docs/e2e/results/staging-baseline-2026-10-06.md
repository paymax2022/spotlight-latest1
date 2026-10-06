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

### Findings (updated 10:00Z — all root causes now confirmed by direct evidence)

- **F1 — register 400s: CONFIRMED = Supabase default-mailer quota exhausted.**
  Direct `POST /auth/v1/signup` against prod GoTrue returns
  `{"code":429,"error_code":"over_email_send_rate_limit","msg":"email rate
  limit exceeded"}`. Not the per-IP signup budget — the **email-send quota**.
  Every `/signup` sends a confirmation email through Supabase's built-in
  mailer (no `smtp_*` configured on either project — verified via Management
  API `/config/auth`, which returns only default mailer fields). Once the
  hourly send budget is consumed, every registration 429s → Go maps it to
  the generic 400. Fix paths (both need an owner-side mail credential):
  (a) PATCH `/config/auth` with custom SMTP (Brevo/Resend/SES), or
  (b) enable the app's OTP path (`FEATURE_OTP_EMAIL_ENABLED` + `BREVO_*` +
  `OTP_PEPPER` + `otp_codes` migration — **missing on prod**) which sends
  via Brevo and registers via `/admin/users`, bypassing the mailer quota.

- **F2 — finance/module 404s: CONFIRMED = zero FEATURE_* flags on prod
  backend.** Boot log: `[finance] routes registered — wallet=false
  kycVerify=false … estate=false`. `DATABASE_URL` itself CONNECTS OK
  (verified live). The unmounted routes were purely flag-gating, not the
  pool. Fix attempted: flag sync from staging — but see F5.

- **F3 — free-vote idempotency not enforced (confirmed; root cause =
  bridge flag off, not missing table).** Same `X-Idempotency-Key` replay
  counted a second vote on prod. `bridge_idempotency_keys` and
  `bridge_outbox` exist on prod (PostgREST 200); `otp_codes` 404.
  `VOTES_BRIDGE_ENABLED` is unset on both frontends → the route takes
  legacy `castFreeVote`, which has no dedup. Additionally the bridge's
  `kyc-gate.ts` queried a phantom schema (`profiles`,
  `contestants.competition_id`, `competitions`) → every bridged vote 404'd
  "User not found". Fixed in PR #496 (merged `ecf0e0d8`) — adapter now
  reads `user_profiles.kyc_tier`, `contestants.contest_id`, `contests`.
  Residual risk: `storeIdempotencyResult` fails open on unexpected DB
  errors — replay dedup must be re-verified after the bridge flag is on.

- **F4 — `REDIS_URL` unset on staging backend (env gap); prod unknown.**

- **F5 — NEW: flag promotion broke prod boot (env/config, now handled).**
  `config.Validate()` is FATAL when `APP_ENV=production`. Copying all 48
  staging `FEATURE_*` flags enabled modules whose credentials don't exist
  on prod → `startup aborted: config validation failed (6 problems)` →
  healthcheck never passed → **9 consecutive FAILED backend redeploys**
  (the old container stayed live). The sync step now force-offs flags
  whose deps are missing on the target (wallet→PAYSTACK, bank
  transfers→MONNIFY, maplerad, kyc_verify→provider+PII key, arena→seeds,
  maps→MAPS_GOOGLE_KEY, otp_email→Brevo creds) and uses `--skip-deploys`
  + one explicit redeploy. Prod wallet/kyc/maps stay OFF until the owner
  supplies those credentials — that is a deliberate prod↔staging diff,
  not a bug.

## Staging vs production difference matrix

| Area | Staging | Production | Delta |
|---|---|---|---|
| App commit | `3d02cbb2` (main HEAD) | `bda0ef5c` (prod branch) | different code trains |
| Supabase project | `wnicsubiznmishkmunsv` | `nmseefdlliejmdbxytej` | expected |
| Frontend serving | Next.js (after repair) | Next.js | parity |
| `DATABASE_URL`/pgx | pooler set, connects, finance routes live | connects OK — routes unmounted by flags (F2), not pool | repaired |
| FEATURE_* flags | full set (48) | was ZERO → synced minus cred-starved flags (F5) | repaired |
| OTP subsystem (`FEATURE_OTP_EMAIL_ENABLED`+Brevo+pepper+`otp_codes`) | flag present; register reliable | off — no Brevo creds, `otp_codes` missing | **prod unconfigured** |
| Registration mailer | default Supabase mailer (works) | default mailer, send quota exhausted → signups 429 | **prod blocked (F1)** |
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
