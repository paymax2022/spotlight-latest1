# Environment & Secrets — source of truth

This is the canonical reference for where every environment value lives and which
ones are secret. The golden rule:

> **Secrets live server-side only** — in `backend/.env` (and, for Next server
> routes, `frontend-web/.env.local`). **Client bundles never carry a secret.**
> Anything prefixed `EXPO_PUBLIC_` (mobile) or `NEXT_PUBLIC_` (web/admin) is
> compiled into the shipped app and is therefore world-readable — put only public
> values there (publishable keys, anon keys, public URLs).

If a value can authorize a charge, a payout, a database write, or impersonate a
user, it is a secret and must not be `EXPO_PUBLIC_`/`NEXT_PUBLIC_`.

## Where files live

| File | Committed? | Holds |
| --- | --- | --- |
| `backend/.env` | No (gitignored) | All backend secrets (real values) |
| `backend/.env.example` | Yes | Backend template with placeholders only |
| `frontend-web/.env.local` | No (gitignored) | Web server-side secrets + `NEXT_PUBLIC_*` |
| `mobile-app/reactnative/.env` | No (gitignored) | Mobile `EXPO_PUBLIC_*` (public only) |
| `*.env.example` | Yes | Templates — placeholders, never real secrets |

`.gitignore` already excludes `.env`, `.env.*`, `.env.local`, `.env_*` snapshots,
and re-includes only `*.env.example`. Verified: no real `.env` is tracked.

## Secret keys — server-side ONLY (`backend/.env`)

Never expose these to a client. The Go backend reads them via `internal/config`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL`, `REDIS_URL` | Datastore connection strings |
| `SUPABASE_SERVICE_ROLE_KEY` | Full-access Supabase key (bypasses RLS) |
| `ADMIN_API_KEY` | Admin API auth |
| `PAYSTACK_SECRET_KEY` | Paystack `sk_…` — charges/verification |
| `PAYSTACK_WEBHOOK_SECRET` | Paystack webhook HMAC signing secret |
| `MONNIFY_API_KEY`, `MONNIFY_SECRET_KEY`, `MONNIFY_WEBHOOK_SECRET` | Monnify transfers |
| `MAPLERAD_SECRET_KEY`, `MAPLERAD_WEBHOOK_SECRET` | Maplerad `sk_…` + webhook |
| `MAPLERAD_PUBLIC_KEY` | Maplerad publishable key (kept server-side; app never calls Maplerad directly) |
| `MAPS_GOOGLE_KEY` | Google Maps (autocomplete, geocoding, Distance Matrix) — **all address lookup runs server-side through this** |
| `MAPS_GEOAPIFY_KEY`, `MAPS_MAPTILER_KEY`, `MAPS_HERE_KEY`, `MAPS_MAPBOX_TOKEN` | Other map provider keys (fallbacks / tiles) |
| `RESEND_API_KEY` | Transactional email |
| `ANTHROPIC_API_KEY`, `INFERMEDICA_APP_KEY` | AI / triage |
| `VIDEOSDK_API_KEY`, `VIDEOSDK_SECRET`, `TERMII_API_KEY` | Video/SMS |
| `EVERSEND_CLIENT_SECRET`, `INVEST_BROKER_API_KEY`, `BNPL_API_KEY`, `PAYOUT_API_KEY`, `DISBURSE_API_KEY`, `BILLING_API_KEY` (+ each `*_WEBHOOK_SECRET`) | Partner integrations |
| `PAYMAX_WEBHOOK_SECRET` | Outbound webhook signing |

## Public values — safe in the client

Mobile (`mobile-app/reactnative/.env`, all `EXPO_PUBLIC_*`):

| Variable | Notes |
| --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | Backend/API base (default `http://localhost:3000`) |
| `EXPO_PUBLIC_MAPS_BASE_URL` | Address-lookup base — see below |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase public anon (RLS-scoped) |
| `EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY` | Paystack **`pk_…`** publishable key only |
| `EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL` | Public deep link |
| `EXPO_PUBLIC_*_USE_MOCK`, `EXPO_PUBLIC_ADDRESS_OFFLINE` | Feature/dev toggles |

Web/admin: only `NEXT_PUBLIC_*` reach the browser; everything else in
`frontend-web/.env.local` stays on the Next server.

## Address lookup & maps (current setup)

All address autocomplete, geocoding, reverse geocoding, and delivery-fee distance
run through the backend MapService, standardized on **Google** (`MAPS_GOOGLE_KEY`,
server-side). To enable: set `FEATURE_MAPS_ENABLED=true` and `MAPS_GOOGLE_KEY` in
`backend/.env` (enable the Places, Geocoding, and Distance Matrix APIs on the key).

`EXPO_PUBLIC_MAPS_BASE_URL` controls where the app sends map requests:

- **unset** → `/api/v1/maps` on `EXPO_PUBLIC_API_BASE_URL` (frontend-web Next proxy → Go). Requires frontend-web running on `:3000`.
- **a full URL** (e.g. `http://localhost:8080/api/finance/maps`) → hit the Go backend directly; frontend-web need not run. The Go origin must be in `CORS_ALLOW_ORIGINS` (`http://localhost:8081` is now allowed by default).
- **`off` / `offline`** → offline-only address lookup (no network calls, clean console) for mock-only dev.

The Google key stays server-side regardless; the app only ever talks to our own
maps endpoint.

## Enforcement (so this can't regress)

Two automated guards back up the rules above:

1. **Fail-fast startup validation** — `backend/internal/config/Validate()` runs in
   `main()`. With `APP_ENV=production` the service **refuses to boot** if a required
   secret (for an enabled feature) is missing, still a placeholder, or the wrong
   shape — e.g. a `pk_` value in `PAYSTACK_SECRET_KEY`, or a `sandbox` Maplerad key
   while `MAPLERAD_PROD=true`. In dev/staging the same checks log warnings only, so
   local work with placeholders still boots. Covered by `validate_test.go`.

2. **Client secret-hygiene guard** — `scripts/check-client-secrets.sh` fails if any
   `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*` var is named like a secret or holds a
   secret-shaped value, or if a committed `*.env.example` contains a real secret. It
   runs in CI (`.github/workflows/ci.yml` → `secret-hygiene`) and in the
   `pre-commit` hook (installed via `scripts/install-git-hooks.sh`). Run it anytime:
   `bash scripts/check-client-secrets.sh`.

## If a secret was ever exposed

Test/sandbox keys were previously present in a client `.env`. They have been moved
server-side, but because they were bundled/committed at some point you should:

1. **Rotate** the affected keys in each provider dashboard (Paystack, Maplerad, …).
2. Set `PAYSTACK_WEBHOOK_SECRET` (still a placeholder in `backend/.env`) to the real
   webhook signing secret so HMAC verification passes.
3. Keep real values only in gitignored `.env` files; commit only `*.env.example`.
