# Platform UAT Environment Baseline — 2026-10-21

Lane: platform (worktree `/tmp/uat-platform`, branch `uat/platform`, off main @ `f0816a2c4`).

## Verdict: FULLY RUNNABLE (after setup)

A working local stack was brought up from scratch this session: local Supabase +
Go backend + Redis + Mailpit + fake-Brevo. Live API testing was executed against it.

## What is actually running / reachable

| Component | State | Detail |
|---|---|---|
| `localhost:8080` | FOREIGN — not ours | Held by an OrbStack-forwarded container from another project (`reaper_…`). Returns 401 `{"error":"Unauthorized"}` on `/readyz`, `/public/build`, `/api/v1/public/build`. **Do not mistake this for the Paymax backend.** The real backend runs on **:8090** (see APP_PORT below) — `make dev`/`docker compose` would collide here. |
| Local Supabase | UP (this session) | `supabase start` — restored an existing local volume; `supabase migration up` applied 46 pending migrations (was at 20271021000000, now current through 20271067000022). API `127.0.0.1:54321`, PG `127.0.0.1:54322`. First `supabase start` attempt failed on a cold pull (db container not yet up when health checks ran); second attempt succeeded. |
| Go backend | UP (this session) | `set -a; . ./.env; set +a; go run ./cmd/server` — healthy at `http://localhost:8090/readyz` → `{db:up, redis:up}`. NOTE: `backend/.env` contains duplicate keys; **last wins** → `APP_PORT=8090`, `REDIS_URL=redis://localhost:6380`. |
| Redis | UP | `startup-redis-1` container maps 6380→6379; also 6379 open. |
| Mailpit | UP | `127.0.0.1:54324` — catches GoTrue mail AND OTP mail via fake-brevo. |
| fake-brevo | UP | `node scripts/dev/fake-brevo.mjs` on :8099, re-posts OTP mail into Mailpit. Required env to exercise OTP email: `FEATURE_OTP_EMAIL_ENABLED=true OTP_PEPPER=… BREVO_API_KEY=fake BREVO_SENDER_EMAIL=… BREVO_OTP_TEMPLATE_ID=1 BREVO_ENDPOINT=http://127.0.0.1:8099/v3/smtp/email` (endpoint honored only when mocks allowed). |
| Frontend web | not started | `npm run dev` on :3000 optional; node_modules symlinked from main checkout for tests. |
| `qa-claude-test@spotlight.internal` | absent | This DB volume predates that fixture; `admin@spotlight.internal` exists. |
| Paystack webhook (Go) | not mounted | `PAYSTACK_SECRET_KEY` unset locally → `webhookHandler == nil` → `POST /api/webhooks/paystack/go` 404s. **Correct fail-closed** — no secret, no receiver. The designated live receiver is the Next route, which 500s on unverifiable signature. |

## Dev login

`scripts/dev/ensure-dev-login.sh` works as documented. `admin@spotlight.internal` /
`LocalDevAdmin123!` — all three layers (GoTrue credential, platform_users lockout,
user_profiles.role=admin) repaired and verified. Caveat observed: the script's
inline grant-verification raced GoTrue propagation and reported FAILED on a
password that was in fact set; a direct retry seconds later succeeded.

## Baseline test results

| Suite | Result |
|---|---|
| `backend && go build ./...` | PASS (exit 0) |
| `go vet ./internal/estate ./internal/stays/... + all platform pkgs` | PASS (note: `./internal/stays` root has no .go files — vet target must be `./internal/stays/...`) |
| `frontend-web && npm run test:regression` | PASS — 10 spec files / **138 tests** (runbook advertises 129; count drifted) |
| `go test` platform pkgs w/ `TEST_DATABASE_URL=postgres://…:54322` | PASS — otp, onboarding, middleware, money, webhooks, finance/ledger, platform/*, provider/*, handlers, repositories, services, tests/ledger, tests/rbac — all `ok`, zero failures incl. live-DB suites |
| vitest webhook specs (`tests/unit/webhooks`, golden-path webhook, voting gateway-fulfilment) | 55 tests → 3 failed on main (stale spec refs, PLT-D002) → **fixed, 18/18 pass** on go-forward.spec |

## Live-verified (evidence in exec-platform.csv)

Register(+dup)/email-OTP verify/password-reset ticket/MFA login/lockout/suspension/
admin suspend+unsuspend/RBAC 403s/forged+missing token 401s/user_profiles RLS/
ledger immutability trigger/onboarding draft→CAC gate→schema validation→submit
replay→admin approve→role grant→capabilities/Idempotency-Key 400s/PIN gate/
OTP resend cooldown.

## Env flags of note (this stack)

- `FEATURE_ONBOARDING_ENABLED=true`, `FEATURE_WALLET_TRANSFERS_ENABLED=true` (in .env)
- `FEATURE_OTP_EMAIL_ENABLED` / `FEATURE_OTP_LOGIN_MFA_ENABLED` — enabled for this run via env override (NOT in .env)
- `FEATURE_SESSION_HARDENING_ENABLED` — OFF (default) → tracked-session revocation inactive; `/api/auth/sessions*` answers `feature_disabled`
- `PAYSTACK_SECRET_KEY` — unset → Go paystack receiver unmounted (correct)
- `RAILS_MODE=fake`, `FAKE_RAILS_*` — provider rails mocked per .env
