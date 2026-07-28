# Production environment-variable matrix

> Authoritative list of env vars across surfaces, with sensitivity and which
> module needs them. Satisfies RELEASE_READINESS §5 ("final production env
> matrix"). Sourced from `frontend-web/.env.example`, `backend/.env.example`,
> `frontend-admin/.env.example`, and `backend/internal/config/config.go`.
>
> Sensitivity: **SECRET** = store in secrets manager, never in repo/CI logs,
> rotate; **public** = safe to expose (NEXT_PUBLIC_*); **config** = non-secret.
> All `FEATURE_*` flags are **config** and default OFF — production-OFF until the
> gated go-live step flips them (`docs/runbooks/go-live.md`).

## Platform / shared

| Var | Surface | Sensitivity | Module | Notes |
|---|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | frontend-web | public | all | |
| `NEXT_PUBLIC_API_BASE_URL` | frontend-web | public | all | browser → Go API |
| `GO_BACKEND_URL` / `GO_API_BASE_URL` | frontend-web | config | proxy | server-side only |
| `NEXT_PUBLIC_SUPABASE_URL` | web/admin | public | auth/data | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web/admin | public | auth/data | RLS-bound public key |
| `SUPABASE_URL` | backend | config | all | falls back to NEXT_PUBLIC_SUPABASE_URL |
| `SUPABASE_SERVICE_ROLE_KEY` | web + backend | **SECRET (CRITICAL)** | all | full DB bypass; rotate first on any leak (INF-3) |
| `DATABASE_URL` | web + backend | **SECRET** | money-path | pgx pool; use session-pooler URL |
| `REDIS_URL` | web + backend | SECRET if hosted has auth | money-path | idempotency / Redlock / asynq |
| `CORS_ALLOW_ORIGINS` | backend | config | all | lock to real origins in prod |
| `APP_PORT` | backend | config | all | default 8080 |
| `SENTRY_DSN` | frontend-web | config | observability | enables Sentry in prod |

## Admin / RBAC

| Var | Surface | Sensitivity | Module | Notes |
|---|---|---|---|---|
| `SPOTLIGHT_ADMIN_API_KEY` | frontend-web | **SECRET (HIGH)** | admin | `openssl rand -hex 32` |
| `ADMIN_API_KEY` | backend | **SECRET (HIGH)** | admin/finance | set strong in prod; empty = open (dev only) |
| `NEXT_PUBLIC_ADMIN_API_BASE_URL` | frontend-admin | public | admin | |
| `NEXT_PUBLIC_*_USE_MOCK` | frontend-admin | config | admin | set to live (`false`) at go-live |

## Payments / wallet / transfers / payouts / VA

| Var | Surface | Sensitivity | Module | Notes |
|---|---|---|---|---|
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | frontend-web | public | wallet/votes | |
| `PAYSTACK_SECRET_KEY` | web + backend | **SECRET (CRITICAL)** | wallet/VA/votes | webhook HMAC-SHA512 + provider API; LIVE key at GA (VA-3) |
| `PAYSTACK_WEBHOOK_SECRET` | backend | **SECRET** | VA/webhooks | defaults to PAYSTACK_SECRET_KEY if unset |
| `PAYMAX_WEBHOOK_OUT_URL` | backend | config | webhooks | outbound webhook target |
| `PAYMAX_WEBHOOK_SECRET` | backend | **SECRET** | webhooks | signs outbound webhooks |
| `VOTE_PAYMENT_REF_PREFIX` | frontend-web | config | votes | optional |

## FX / alternative providers

| Var | Surface | Sensitivity | Module | Notes |
|---|---|---|---|---|
| `MAPLERAD_SECRET_KEY` | web + backend | **SECRET** | FX/VA | |
| `MAPLERAD_PUBLIC_KEY` | backend | config | FX/VA | |
| `MAPLERAD_WEBHOOK_SECRET` | backend | **SECRET** | FX/VA | |
| `MAPLERAD_PROD` | web + backend | config | FX/VA | flag: live vs sandbox |
| `EVERSEND_CLIENT_ID` | backend | config | FX | |
| `EVERSEND_CLIENT_SECRET` | backend | **SECRET** | FX | |
| `EVERSEND_WEBHOOK_SECRET` | backend | **SECRET** | FX | |
| `EVERSEND_PROD` | backend | config | FX | |

## Utility / bills

| Var | Surface | Sensitivity | Module | Notes |
|---|---|---|---|---|
| `UTILITY_PROVIDER_CREDENTIALS_KEY` | frontend-web | **SECRET** | utility | encrypts stored provider creds; `openssl rand -base64 32` |
| `UTILITY_PROVIDER_TIMEOUT_MS` | frontend-web | config | utility | |
| `VTPASS_ENVIRONMENT` / `VTPASS_BASE_URL` | frontend-web | config | utility | |
| `VTPASS_API_KEY` / `VTPASS_PUBLIC_KEY` / `VTPASS_SECRET_KEY` | frontend-web | **SECRET** | utility | |

## Doctor / telemedicine (RTC)

| Var | Surface | Sensitivity | Module | Notes |
|---|---|---|---|---|
| `AGORA_APP_ID` | backend | config | doctor | RTC app id |
| `AGORA_APP_CERTIFICATE` | backend | **SECRET** | doctor | signs RTC tokens |
| `VIDEOSDK_API_KEY` | backend | **SECRET** | doctor | RTC provider |
| `VIDEOSDK_SECRET` | backend | **SECRET** | doctor | RTC provider |

## AI / connect / messaging

| Var | Surface | Sensitivity | Module | Notes |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | web + backend | **SECRET** | realtor AI / aicare | server-side only |
| `ANTHROPIC_REALTOR_MODEL` | frontend-web | config | realtor | model override |
| `CONNECT_VERIFICATION_PEPPER` | backend | **SECRET** | connect | hashing pepper; rotating invalidates hashes |
| `RESEND_API_KEY` | web + backend | **SECRET (HIGH)** | email | |
| `EMAIL_FROM` / `RESEND_FROM_EMAIL` | web/backend | config | email | |
| `CONTACT_INBOX_EMAIL` | frontend-web | config | contact | |
| `TERMII_API_KEY` | backend | **SECRET** | SMS/OTP | |
| `TERMII_SENDER_ID` | backend | config | SMS/OTP | |
| `EXPO_PUSH_TOKEN` | backend | **SECRET** | push | |

## Storage (R2)

| Var | Surface | Sensitivity | Module | Notes |
|---|---|---|---|---|
| `R2_ACCOUNT_ID` | frontend-web | **SECRET (HIGH)** | storage | |
| `R2_ACCESS_KEY_ID` | frontend-web | **SECRET (HIGH)** | storage | |
| `R2_SECRET_ACCESS_KEY` | frontend-web | **SECRET (CRITICAL)** | storage | scope to one bucket |
| `R2_BUCKET` | frontend-web | config | storage | `spotlight-open-mic` |
| `R2_PUBLIC_BASE_URL` | frontend-web | config | storage | optional CDN |

## Maps

| Var | Surface | Sensitivity | Module | Notes |
|---|---|---|---|---|
| `MAPS_CONFIG_PATH` / `MAPS_DEFAULT_SURFACE` | backend | config | maps | provider routing |
| `MAPS_GEOAPIFY_KEY` / `MAPS_MAPTILER_KEY` / `MAPS_GOOGLE_KEY` / `MAPS_MAPBOX_TOKEN` | backend | **SECRET** | maps | one legit key per provider — no rotation-to-dodge-limits |
| `MAPS_OSRM_BASE_URL` / `MAPS_TILE_STYLE_URL` | backend | config | maps | |
| `MAPS_RATE_LIMIT_PER_MIN` | backend | config | maps | cost guard |
| `MAPS_BUDGET_ALERT_WEBHOOK` | backend | SECRET (URL) | maps | budget alerts |

## Feature flags (all config, default OFF, flip only at gated go-live)

Money-path & high-risk: `FEATURE_WALLET_ENABLED`, `FEATURE_KYC_ENABLED`,
`FEATURE_VIRTUAL_ACCOUNTS_ENABLED`, `FEATURE_TRANSFERS_ENABLED`,
`FEATURE_TIER_LIMITS_ENABLED`, `FEATURE_REFERRALS_ENABLED`,
`FEATURE_FINTECH_ADMIN_ENABLED`, `VOTES_BRIDGE_ENABLED`,
`FEATURE_VOTE_BRIDGE_ENABLED`, `FEATURE_FX_ENABLED`,
`FEATURE_FX_ORCHESTRATION_ENABLED`, `FEATURE_UTILITY_PAYMENTS_ENABLED`,
`FEATURE_INVEST_ENABLED`.

Verticals: `FEATURE_GROUPS_ENABLED`, `FEATURE_ASSOCIATIONS_ENABLED`/`..._ASSOCIATION_ENABLED`,
`FEATURE_EVENTS_ENABLED`, `FEATURE_ESTATE_ENABLED`, `FEATURE_CROWDFUNDING_ENABLED`,
`FEATURE_RESTAURANT_ENABLED`, `FEATURE_TELEMEDICINE_ENABLED`,
`FEATURE_DOCTOR_ENABLED`, `FEATURE_PHARMACY_ENABLED`, `FEATURE_TRANSPORT_ENABLED`,
`FEATURE_TRANSPORT_MODES_ENABLED`, `FEATURE_AICARE_ENABLED`,
`FEATURE_DISPUTES_ENABLED`, `FEATURE_RATINGS_ENABLED`, `FEATURE_ONBOARDING_ENABLED`,
`FEATURE_MAPS_ENABLED`, `FEATURE_CONNECT_ENABLED`, `FEATURE_REALTOR_ENABLED`.

> Note: `backend/.env.example` currently ships some flags as `true` for local dev
> (`FEATURE_TRANSPORT_ENABLED`, `FEATURE_TRANSPORT_MODES_ENABLED`,
> `FEATURE_FX_ORCHESTRATION_ENABLED`). For PRODUCTION every flag starts OFF and
> is enabled only via the gated go-live runbook. Do not copy the dev template's
> ON values to prod.

## .env.example coverage gaps to close

- `frontend-web/.env.example` does not list `SENTRY_DSN`, `GO_API_BASE_URL`
  duplication aside. Add `SENTRY_DSN` so observability is configurable.
- `backend/.env.example` does not list `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`,
  `VIDEOSDK_*`, `ANTHROPIC_API_KEY`, `CONNECT_VERIFICATION_PEPPER`, `TERMII_*`,
  `RESEND_API_KEY`, `EXPO_PUSH_TOKEN`, `PAYSTACK_*`, `PAYMAX_WEBHOOK_*` though
  `config.go` reads them. Owners of those modules should add them to the template
  (additive doc change) so the matrix and template agree.
