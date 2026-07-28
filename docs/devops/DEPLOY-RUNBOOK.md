# Paymax × Spotlight — Production Deploy Runbook

End-to-end, build-once → migrate → staging → production. This is the operational
companion to `GO-LIVE-FINAL.md` (readiness matrix) and `ENVIRONMENT-AND-GOLIVE.md`
(environments + rails). Everything below runs in the dev container / CI — **not** from
the authoring sandbox (no infra/secrets there). Secrets come from the secret manager at
deploy time; never commit live keys or paste them in chat.

## 0. Preconditions (once per environment)

- Postgres/Supabase reachable; `DATABASE_URL` set in the deploy environment only.
- Secret manager holds: Supabase URL/anon/service-role keys, Paystack/Maplerad keys (if
  live rails), `WS_TICKET_SIGNING_SECRET` (shared by frontend-web + backend for food WS),
  LLM key (health triage), provider keys per module.
- `RAILS_MODE` set per environment: `fake` (dev), `sandbox` (staging), `live` (prod).
- A seeded admin: a `user_profiles` row with `role='admin'` for console login.
- Feature flags decided per environment (all default OFF — opt-in per module).

## 1. Verify (the single gate — must be green before promoting)

```
make bootstrap        # go mod download + npm ci (web + admin)
make verify           # build + vet + tsc(web+admin) + contract-check
                      # + migrate-reset (clean-apply + idempotency) + test -race + security-scan
```

`make verify` is authoritative. It is also the CI job (`.github/workflows/integration-verify.yml`).
Do not promote on red. (In the authoring sandbox only structural review was possible — no Go
toolchain — so the first real green must come from the dev container/CI.)

## 2. Migrate

Additive-only, forward-only (CLAUDE.md). 226 migrations in `supabase/migrations/` including
the new `20260815001600_crypto.sql`.

```
make migrate-up       # apply pending migrations to $DATABASE_URL
# (make verify already runs migrate-reset to prove clean-apply + idempotency in CI)
```

There are **no un-authored modules** — every feature module has its tables. "Migrate the full
suite" = run the above against each environment's database in order: dev → staging → prod.

## 3. Build once, promote the same artifact

```
make docker-build SHA=$(git rev-parse --short HEAD)   # backend image tagged by commit
# frontends: next build in frontend-web and frontend-admin (admin serves :3001/admin)
```

Promote the SAME image/bundle through staging → prod (build-once). The pipeline skeleton is
`.github/workflows/deploy.yml`.

## 4. Configure each surface for the environment

Backend (env / secret manager): `DATABASE_URL`, `REDIS_URL`, `RAILS_MODE`, provider keys,
`WS_TICKET_SIGNING_SECRET`, and the `FEATURE_*` flags you intend to enable (e.g.
`FEATURE_CRYPTO_ENABLED`, `FEATURE_P2P_MARKET_ENABLED`, `FEATURE_HEALTH_TRIAGE_ENABLED`, …).
Templates: `.env.dev.example`.

frontend-web: `GO_BACKEND_URL` (+ optional `GO_BACKEND_WS_URL`), Supabase keys,
`WS_TICKET_SIGNING_SECRET`, and the 35 `FEATURE_*` proxy flags. Template:
`frontend-web/.env.production.example`.

frontend-admin (:3001): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_ADMIN_API_BASE_URL`, and `NEXT_PUBLIC_*_ADMIN_USE_MOCK=false` per module.
Template: `frontend-admin/.env.production.example`.

mobile (Expo): `EXPO_PUBLIC_API_BASE_URL` = prod frontend-web origin; the 51
`EXPO_PUBLIC_*_USE_MOCK=false`. Source of truth: `mobile-app/reactnative/.env.production`
(+ `docs/GO-LIVE-CONFIG.md`). A module goes live only when: backend flag ON → `/api/v1/*`
proxy exists → `USE_MOCK=false` → smoke test.

## 5. Smoke test (post-deploy, per enabled module)

- Auth: log in to `:3001/admin` (seeded admin → full sidebar; backend RBAC enforced per route).
- Money path: a wallet top-up + a transfer with an `Idempotency-Key`; replay the same key →
  no double-spend (the proxy now forwards `Idempotency-Key`).
- One flow per enabled vertical (food order, a health booking, a vote, a savings deposit).
- Food live tracking: place an order, confirm the WS connects via the signed ticket.

## 6. Rollback

Flags are the fast lever: turn a misbehaving module's `FEATURE_*` OFF (no redeploy needed for
gating). For code: redeploy the previous build-once image. Migrations are additive/forward-only,
so DB rollback is by compensating migration, never destructive `DROP`.

## Module enablement cheat-sheet (flag → surfaces)

| Module | Backend flag | Web proxy flag | Admin mock flag | Mobile flag |
|---|---|---|---|---|
| crypto | FEATURE_CRYPTO_ENABLED | (proxy, no flag) | — | EXPO_PUBLIC_CRYPTO_USE_MOCK=false |
| p2p market | FEATURE_P2P_MARKET_ENABLED | — | NEXT_PUBLIC_P2PMARKET_ADMIN_USE_MOCK=false | (via proxy) |
| food + live WS | FEATURE_RESTAURANT_ENABLED + WS_TICKET_SIGNING_SECRET | FEATURE_RESTAURANT_ENABLED | NEXT_PUBLIC_RESTAURANT_ADMIN_USE_MOCK=false | EXPO_PUBLIC_FOOD/RESTAURANT_USE_MOCK=false |
| health triage | FEATURE_HEALTH_TRIAGE_ENABLED (+ engine/LLM keys) | FEATURE_HEALTH_ENABLED | NEXT_PUBLIC_HEALTH_USE_MOCK=false | EXPO_PUBLIC_HEALTH_USE_MOCK=false |
| telemedicine/groups/association/spray/points | respective FEATURE_* | respective | new *_ADMIN_USE_MOCK=false | respective |

All other modules follow the same four-flag pattern; see `GO-LIVE-FINAL.md` for the full matrix.

## Known production caveats (carried from GO-LIVE-FINAL)

- **Food WS**: backend ticket validation is now implemented (`restaurant/ws_ticket.go`); set the
  shared `WS_TICKET_SIGNING_SECRET` on both frontend-web and backend or live tracking falls back.
- **crypto**: ships with a deterministic mock price provider; wire a real price/exchange adapter
  before real trading, and keep `FEATURE_CRYPTO_ENABLED` OFF until then.
- **health triage**: needs licensed-engine creds + clinical vignette sign-off before real patients
  (`docs/health/AI-SYMPTOM-CHECKER-PHASE1.md`).
- **Provider rails** fall back to in-process fakes when keys are absent (no loud failure) — set
  `RAILS_MODE` + keys correctly per environment and verify in smoke tests.
