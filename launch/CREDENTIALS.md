# Launch Credentials Runbook — Paymax × Spotlight

This folder is the single place to manage every third-party credential for launch.

## TL;DR — how to fill credentials

```bash
cp launch/master.env.template launch/master.env   # 1. create your private copy
# 2. edit launch/master.env and fill in the values (it is git-ignored)
bash launch/apply-env.sh                           # 3. write all per-surface .env files
```

`apply-env.sh` takes the single `master.env` and writes, with the correct variable
names/prefixes for each app:

| Output file | Surface |
|---|---|
| `backend/.env` | Go API (server-only secrets) |
| `frontend-web/.env.local` | Next.js web (NEXT_PUBLIC_* + server secrets) |
| `frontend-admin/.env.local` | Admin console |
| `mobile-app/reactnative/.env` | Expo app (EXPO_PUBLIC_* only) |

Existing files are backed up to `*.bak.<timestamp>` first. Re-run after any rotation.

---

## ⚠️ Security remediation (done) + required rotation (you must do)

**Done in the repo:** 52 committed `.env` snapshots under `.history/` and
`.agentwork/*/.history/` were removed from git tracking (`git rm --cached`), and
`.gitignore` now blocks `.history/`, `.agentwork/`, `.env_*`, `.env.local`, and
`launch/master.env`. Commit this change.

**Still required — the secrets remain in past git history**, so removing them from
tracking is not enough. Rotate every key that was ever in those snapshots:

| Key | Where to rotate |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` (and anon key) | Supabase → Project Settings → API → "Reset" |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Cloudflare → R2 → Manage API Tokens → roll |
| `MAILGUN_API_KEY` | Mailgun → Settings → API Keys → regenerate |
| `PAYSTACK_SECRET_KEY` | Paystack → Settings → API Keys → roll (then switch test→live) |
| `VTPASS_API_KEY` / `VTPASS_SECRET_KEY` | VTpass dashboard → API settings |
| `STITCH_API_KEY` | Stitch dashboard → rotate client secret |

> To purge them from history entirely, run `git filter-repo` (or BFG) on the paths
> in `/tmp/leaked_env_files.txt` after rotation. Rotation is the real fix; history
> scrubbing is hygiene.

---

## Generate the secrets you create yourself

```bash
ADMIN_API_KEY:                    openssl rand -hex 32
UTILITY_PROVIDER_CREDENTIALS_KEY: openssl rand -base64 32
CONNECT_VERIFICATION_PEPPER:      openssl rand -hex 32
```

---

## Credential inventory by provider

Legend: **R** = required for the Core+Payments launch · ✦ = has test/live variants.

### Core platform (R)
- **Supabase** — `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public), `SUPABASE_SERVICE_ROLE_KEY` (secret).
- **Postgres** — `DATABASE_URL` (direct/session-pooler connection, `sslmode=require`).
- **Redis** — `REDIS_URL` (managed).
- **Admin key** — `ADMIN_API_KEY` (= `SPOTLIGHT_ADMIN_API_KEY` on web). Generate it.

### Payments — Paystack (R) ✦
- `PAYSTACK_PUBLIC_KEY` (`pk_test_`/`pk_live_`), `PAYSTACK_SECRET_KEY` (`sk_test_`/`sk_live_`),
  `PAYSTACK_WEBHOOK_SECRET` (HMAC-SHA512 verify), `PAYSTACK_DVA_BANK` (default `wema-bank`).
- Set `PAYSTACK_MODE=live` and swap to `*_live_` keys at go-live.

### Utility bills — VTpass (optional) ✦
- `VTPASS_ENVIRONMENT` (`sandbox`/`live`), `VTPASS_API_KEY`, `VTPASS_PUBLIC_KEY`, `VTPASS_SECRET_KEY`,
  plus `UTILITY_PROVIDER_CREDENTIALS_KEY` (encryption key — generate it).

### FX — Maplerad / Eversend (optional) ✦
- `MAPLERAD_SECRET_KEY`/`MAPLERAD_PUBLIC_KEY` (`mpr_sandbox_*`/`mpr_prod_*`), `MAPLERAD_PROD`, `MAPLERAD_WEBHOOK_SECRET`.
- `EVERSEND_CLIENT_ID`/`EVERSEND_CLIENT_SECRET`, `EVERSEND_PROD`, `EVERSEND_WEBHOOK_SECRET`.

### Storage — Cloudflare R2 (optional)
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
  Endpoint auto-derived: `https://<account-id>.r2.cloudflarestorage.com`.

### Email / SMS / Push (optional)
- Email: **Mailgun** (`MAILGUN_API_KEY`,`MAILGUN_DOMAIN`,`MAILGUN_REGION`) *or* **Resend** (`RESEND_API_KEY`).
- SMS: **Termii** (`TERMII_API_KEY`,`TERMII_SENDER_ID`). Push: `EXPO_PUSH_TOKEN`.

### AI / RTC / Maps (optional)
- **Anthropic** `ANTHROPIC_API_KEY`. RTC: **Agora** (`AGORA_APP_ID`,`AGORA_APP_CERTIFICATE`) or **VideoSDK** (`VIDEOSDK_API_KEY`,`VIDEOSDK_SECRET`).
- Maps: `MAPS_PROVIDER` (`mock`/`http`) + `MAPS_GEOAPIFY_KEY`, `MAPS_MAPTILER_KEY`, `MAPS_OSRM_BASE_URL`, `MAPS_GOOGLE_KEY`, `MAPS_MAPBOX_TOKEN`.

### Invest providers (optional — keep flag OFF until compliance)
- `INVEST_BROKER_BASE_URL`/`INVEST_BROKER_API_KEY`/`INVEST_BROKER_WEBHOOK_SECRET`, `INVEST_MARKETDATA_BASE_URL`/`INVEST_MARKETDATA_API_KEY`.

### Deploy secrets (set in GitHub → Settings → Secrets, NOT in .env)
- `CPANEL_SSH_HOST`, `CPANEL_SSH_USER`, `CPANEL_SSH_KEY`, `CPANEL_SSH_PORT`, `DEPLOY_PATH`.
- `OPENAI_API_KEY` — only referenced by `supabase/config.toml` (Supabase shell env).

---

## Feature-flag posture (set by apply-env.sh)

Core money path **ON**: wallet, KYC, virtual accounts, tier limits.
Risk-sensitive **OFF** until you flip them: transfers (P2P/bank), FX, utility payments,
disputes, ratings, estate/realtor/property suite, maps. Edit the `FEATURE_FLAGS` block
in `apply-env.sh` to widen the launch, then re-run it.

**Mobile/admin mock flags** are per-module go-live switches — flip a module's
`*_USE_MOCK` to `false` only after its backend is live and smoke-tested. See
`mobile-app/reactnative/.env.production.example` for the full list.

---

## Pre-launch checklist

- [ ] Rotate all leaked keys (table above).
- [ ] `cp master.env.template master.env`, fill Core+Payments values, `bash launch/apply-env.sh`.
- [ ] `ADMIN_API_KEY` set to a strong random value (not blank — blank = open admin routes).
- [ ] `CORS_ALLOW_ORIGINS` set to production web + admin origins only.
- [ ] Paystack switched to live keys + live webhook secret; webhook URL registered.
- [ ] `DATABASE_URL` + `REDIS_URL` point at production infra; `supabase db push` applied.
- [ ] GitHub deploy secrets configured.
- [ ] Confirm `git status` shows no `.env`/`master.env` staged (all ignored).
