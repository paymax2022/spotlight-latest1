#!/usr/bin/env bash
# ============================================================================
#  apply-env.sh — split launch/master.env into each surface's .env file.
#  Fill launch/master.env (from master.env.template), then run this script.
#  Re-run after rotating any key. Existing targets are backed up first.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MASTER="$ROOT/launch/master.env"
STAMP="$(date +%Y%m%d%H%M%S)"

if [[ ! -f "$MASTER" ]]; then
  echo "ERROR: $MASTER not found."
  echo "  Run: cp launch/master.env.template launch/master.env  then fill it in."
  exit 1
fi

# Load master.env into the environment (all keys become shell vars).
set -a; # shellcheck disable=SC1090
. "$MASTER"; set +a

# Defaults for anything left blank in master.env (keeps output valid).
: "${PAYSTACK_DVA_BANK:=wema-bank}"
: "${VERTOFX_PROD:=false}"; : "${EVERSEND_PROD:=false}"
# R2_BUCKET is deliberately NOT defaulted. It used to fall back to
# "spotlight-open-mic", a bucket that does not exist in the account, which
# made every generated environment look configured and then fail at upload
# time with NoSuchBucket. Blank flows through to the backend, where an empty
# bucket fails closed as "uploads are not configured" — an honest 503 rather
# than a broken PUT. Set it in master.env.
: "${MAPS_PROVIDER:=mock}"
: "${APP_ENV:=production}"
: "${DOJAH_PROD:=false}"
: "${CRYPTO_PROVIDER:=mock}"
: "${SITE_URL_WEB:=http://localhost:3000}"
: "${API_BASE_URL_PUBLIC:=http://localhost:8080/api/v1}"
: "${GO_BACKEND_URL:=http://localhost:8080}"
: "${ADMIN_API_BASE_URL:=http://localhost:8080/api/v1}"
: "${CORS_ALLOW_ORIGINS:=http://localhost:3000,http://localhost:4030}"
: "${REDIS_URL:=redis://localhost:6379}"
: "${TERMII_SENDER_ID:=Paymax}"
: "${RESEND_FROM_EMAIL:=Spotlight <no-reply@spotlightng.com>}"
: "${EMAIL_FROM:=Spotlight <no-reply@spotlightng.com>}"
: "${MAILGUN_REGION:=us}"

# Derive the R2 S3 endpoint from the account id when not given explicitly.
if [[ -z "${R2_ACCOUNT_ENDPOINT:-}" && -n "${R2_ACCOUNT_ID:-}" ]]; then
  R2_ACCOUNT_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
fi

# ---- Launch feature flags. Edit here to widen the launch. -------------------
# Launch-critical set ON (Core+Payments + referrals + transfers + crypto):
#   wallet/KYC/VA/tier-limits  — foundational money path
#   referrals + rewards engine — Direct Referral Rewards (/v1/referrals),
#     §7A attribution/house (/api/finance/referral) and the commission split
#   transfers                  — P2P wallet transfers + wallet→bank payouts
#     (what referral rewards cash out through)
# KYC-verify and crypto are NOT in this block — their flags are derived from
# credential presence below, because config validation is fatal when either is
# enabled without its provider.
read -r -d '' FEATURE_FLAGS <<'FLAGS' || true
FEATURE_WALLET_ENABLED=true
FEATURE_KYC_ENABLED=true
FEATURE_VIRTUAL_ACCOUNTS_ENABLED=true
FEATURE_TIER_LIMITS_ENABLED=true
FEATURE_REFERRALS_ENABLED=true
FEATURE_REFERRAL_REWARDS_ENABLED=true
FEATURE_COMMISSION_ENABLED=true
FEATURE_REFERRAL_COMMISSION_SPLIT_ENABLED=true
FEATURE_TRANSFERS_ENABLED=true
FEATURE_WALLET_TRANSFERS_ENABLED=true
FEATURE_BANK_TRANSFERS_ENABLED=true
FEATURE_DISPUTES_ENABLED=false
FEATURE_RATINGS_ENABLED=false
FEATURE_FX_ENABLED=false
FEATURE_FX_ORCHESTRATION_ENABLED=false
FEATURE_UTILITY_PAYMENTS_ENABLED=false
FEATURE_ESTATE_ENABLED=false
FEATURE_REALTOR_ENABLED=false
FEATURE_PROPERTY_SUITE_ENABLED=false
FEATURE_MAPS_ENABLED=false
FLAGS

# ── Credential-gated flags (launch blockers when their creds are absent) ──────
# FEATURE_KYC_VERIFY_ENABLED with no provider fails config validation in any
# non-dev environment; KYC_PII_ENC_KEY is mandatory whenever it is on.
KYC_VERIFY_FLAG="FEATURE_KYC_VERIFY_ENABLED=false"
if [[ -n "${DOJAH_APP_ID:-}" && -n "${DOJAH_SECRET_KEY:-}" && -n "${KYC_PII_ENC_KEY:-}" ]]; then
  KYC_VERIFY_FLAG="FEATURE_KYC_VERIFY_ENABLED=true"
else
  echo "  WARN: Dojah KYC disabled — set DOJAH_APP_ID + DOJAH_SECRET_KEY + KYC_PII_ENC_KEY (launch blocker)"
fi

# FEATURE_CRYPTO_ENABLED without a real provider fails strict validation
# everywhere — the mock serves fabricated prices, which must never reach users.
# Staging/development use the TEST key; production uses the LIVE key.
ENV_LOWER="$(printf '%s' "$APP_ENV" | tr '[:upper:]' '[:lower:]')"
QUIDAX_KEY="${QUIDAX_TEST_API_KEY:-}"
if [[ "$ENV_LOWER" == "production" || "$ENV_LOWER" == "prod" ]]; then
  QUIDAX_KEY="${QUIDAX_LIVE_API_KEY:-}"
fi
CRYPTO_BLOCK="FEATURE_CRYPTO_ENABLED=false
CRYPTO_PROVIDER=mock"
if [[ "$CRYPTO_PROVIDER" == "quidax" && -n "$QUIDAX_KEY" ]]; then
  CRYPTO_BLOCK="FEATURE_CRYPTO_ENABLED=true
CRYPTO_PROVIDER=quidax"
else
  echo "  WARN: crypto funding disabled — set CRYPTO_PROVIDER=quidax + the QUIDAX_*_API_KEY for $APP_ENV (launch blocker)"
fi

backup() { if [[ -f "$1" ]]; then cp "$1" "$1.bak.$STAMP"; echo "  backed up $1 → $1.bak.$STAMP"; fi; return 0; }
write() { local p="$1"; shift; mkdir -p "$(dirname "$p")"; backup "$p"; cat > "$p"; chmod 600 "$p"; echo "  wrote $p (chmod 600)"; }

echo "Applying launch/master.env → per-surface .env files ..."

# ---- backend/.env -----------------------------------------------------------
write "$ROOT/backend/.env" <<EOF
# Generated by launch/apply-env.sh on $STAMP — DO NOT COMMIT.
APP_ENV=$APP_ENV
APP_PORT=8080
CORS_ALLOW_ORIGINS=$CORS_ALLOW_ORIGINS
DATABASE_URL=${DATABASE_URL:-}
REDIS_URL=$REDIS_URL
SUPABASE_URL=${SUPABASE_URL:-}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY:-}
ADMIN_API_KEY=${ADMIN_API_KEY:-}
PAYSTACK_SECRET_KEY=${PAYSTACK_SECRET_KEY:-}
PAYSTACK_WEBHOOK_SECRET=${PAYSTACK_WEBHOOK_SECRET:-}
VERTOFX_CLIENT_ID=${VERTOFX_CLIENT_ID:-}
VERTOFX_API_KEY=${VERTOFX_API_KEY:-}
VERTOFX_PROD=$VERTOFX_PROD
VERTOFX_WEBHOOK_SECRET=${VERTOFX_WEBHOOK_SECRET:-}
EVERSEND_CLIENT_ID=${EVERSEND_CLIENT_ID:-}
EVERSEND_CLIENT_SECRET=${EVERSEND_CLIENT_SECRET:-}
EVERSEND_PROD=$EVERSEND_PROD
EVERSEND_WEBHOOK_SECRET=${EVERSEND_WEBHOOK_SECRET:-}
R2_ACCOUNT_ENDPOINT=${R2_ACCOUNT_ENDPOINT:-}
R2_BUCKET=${R2_BUCKET:-}
R2_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID:-}
R2_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY:-}
R2_REGION=auto
RESEND_API_KEY=${RESEND_API_KEY:-}
RESEND_FROM_EMAIL=$RESEND_FROM_EMAIL
TERMII_API_KEY=${TERMII_API_KEY:-}
TERMII_SENDER_ID=$TERMII_SENDER_ID
EXPO_PUSH_TOKEN=${EXPO_PUSH_TOKEN:-}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
VIDEOSDK_API_KEY=${VIDEOSDK_API_KEY:-}
VIDEOSDK_SECRET=${VIDEOSDK_SECRET:-}
MAPS_PROVIDER=$MAPS_PROVIDER
MAPS_GEOAPIFY_KEY=${MAPS_GEOAPIFY_KEY:-}
MAPS_MAPTILER_KEY=${MAPS_MAPTILER_KEY:-}
MAPS_OSRM_BASE_URL=${MAPS_OSRM_BASE_URL:-}
MAPS_GOOGLE_KEY=${MAPS_GOOGLE_KEY:-}
MAPS_MAPBOX_TOKEN=${MAPS_MAPBOX_TOKEN:-}
INVEST_BROKER_BASE_URL=${INVEST_BROKER_BASE_URL:-}
INVEST_BROKER_API_KEY=${INVEST_BROKER_API_KEY:-}
INVEST_BROKER_WEBHOOK_SECRET=${INVEST_BROKER_WEBHOOK_SECRET:-}
INVEST_MARKETDATA_BASE_URL=${INVEST_MARKETDATA_BASE_URL:-}
INVEST_MARKETDATA_API_KEY=${INVEST_MARKETDATA_API_KEY:-}
PAYMAX_WEBHOOK_OUT_URL=${PAYMAX_WEBHOOK_OUT_URL:-}
PAYMAX_WEBHOOK_SECRET=${PAYMAX_WEBHOOK_SECRET:-}
CONNECT_VERIFICATION_PEPPER=${CONNECT_VERIFICATION_PEPPER:-}
DOJAH_APP_ID=${DOJAH_APP_ID:-}
DOJAH_SECRET_KEY=${DOJAH_SECRET_KEY:-}
DOJAH_PROD=$DOJAH_PROD
DOJAH_WEBHOOK_SECRET=${DOJAH_WEBHOOK_SECRET:-}
KYC_PII_ENC_KEY=${KYC_PII_ENC_KEY:-}
QUIDAX_TEST_API_KEY=${QUIDAX_TEST_API_KEY:-}
QUIDAX_TEST_BASE_URL=${QUIDAX_TEST_BASE_URL:-https://openapi.quidax.io/exchange-open-api/api/v1}
QUIDAX_LIVE_API_KEY=${QUIDAX_LIVE_API_KEY:-}
QUIDAX_LIVE_BASE_URL=${QUIDAX_LIVE_BASE_URL:-https://openapi.quidax.io/exchange-open-api/api/v1}
SUPER_ADMIN_REFERRAL_CODE=${SUPER_ADMIN_REFERRAL_CODE:-}
SUPER_ADMIN_USER_ID=${SUPER_ADMIN_USER_ID:-}
REFERRAL_REWARDS_INTERNAL_SECRET=${REFERRAL_REWARDS_INTERNAL_SECRET:-}
$FEATURE_FLAGS
$KYC_VERIFY_FLAG
$CRYPTO_BLOCK
EOF

# ---- frontend-web/.env.local ------------------------------------------------
write "$ROOT/frontend-web/.env.local" <<EOF
# Generated by launch/apply-env.sh on $STAMP — DO NOT COMMIT.
NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL:-}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:-}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY:-}
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=${PAYSTACK_PUBLIC_KEY:-}
PAYSTACK_SECRET_KEY=${PAYSTACK_SECRET_KEY:-}
PAYSTACK_DVA_BANK=$PAYSTACK_DVA_BANK
R2_ACCOUNT_ID=${R2_ACCOUNT_ID:-}
CLOUDFLARE_ACCOUNT_ID=${R2_ACCOUNT_ID:-}
R2_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID:-}
R2_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY:-}
R2_BUCKET=${R2_BUCKET:-}
R2_ENDPOINT=${R2_ACCOUNT_ENDPOINT:-}
R2_PUBLIC_BASE_URL=${R2_PUBLIC_BASE_URL:-}
MAILGUN_API_KEY=${MAILGUN_API_KEY:-}
MAILGUN_DOMAIN=${MAILGUN_DOMAIN:-}
MAILGUN_REGION=$MAILGUN_REGION
RESEND_API_KEY=${RESEND_API_KEY:-}
EMAIL_FROM=$EMAIL_FROM
VTPASS_ENVIRONMENT=${VTPASS_ENVIRONMENT:-}
VTPASS_API_KEY=${VTPASS_API_KEY:-}
VTPASS_PUBLIC_KEY=${VTPASS_PUBLIC_KEY:-}
VTPASS_SECRET_KEY=${VTPASS_SECRET_KEY:-}
UTILITY_PROVIDER_CREDENTIALS_KEY=${UTILITY_PROVIDER_CREDENTIALS_KEY:-}
NEXT_PUBLIC_SITE_URL=$SITE_URL_WEB
NEXT_PUBLIC_API_BASE_URL=$API_BASE_URL_PUBLIC
GO_BACKEND_URL=$GO_BACKEND_URL
GO_API_BASE_URL=$GO_BACKEND_URL
DATABASE_URL=${DATABASE_URL:-}
REDIS_URL=$REDIS_URL
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
ANTHROPIC_REALTOR_MODEL=claude-haiku-4-5-20251001
SPOTLIGHT_ADMIN_API_KEY=${ADMIN_API_KEY:-}
STITCH_API_KEY=${STITCH_API_KEY:-}
$FEATURE_FLAGS
EOF

# ---- frontend-admin/.env.local ----------------------------------------------
write "$ROOT/frontend-admin/.env.local" <<EOF
# Generated by launch/apply-env.sh on $STAMP — DO NOT COMMIT.
NEXT_PUBLIC_ADMIN_API_BASE_URL=$ADMIN_API_BASE_URL
NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL=${LEGACY_ADMIN_BASE_URL:-http://localhost:4028}
NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL:-}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:-}
NEXT_PUBLIC_ADMIN_API_KEY=${ADMIN_API_KEY:-}
# Module mock flags: flip a module to false only after its backend is live.
# (Defaults live in code; uncomment to override per go-live.)
# NEXT_PUBLIC_ESTATE_ADMIN_USE_MOCK=false
# NEXT_PUBLIC_REALTOR_ADMIN_USE_MOCK=false
EOF

# ---- mobile-app/reactnative/.env --------------------------------------------
write "$ROOT/mobile-app/reactnative/.env" <<EOF
# Generated by launch/apply-env.sh on $STAMP — DO NOT COMMIT.
EXPO_PUBLIC_APP_ENV=${APP_ENV:-production}
EXPO_PUBLIC_SUPABASE_URL=${SUPABASE_URL:-}
EXPO_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:-}
EXPO_PUBLIC_API_BASE_URL=$SITE_URL_WEB
EXPO_PUBLIC_MAPS_BASE_URL=$API_BASE_URL_PUBLIC
EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL=paymaxrn://auth/reset-password
# Module mock flags: see mobile-app/reactnative/.env.production.example for the
# full list. Flip a module to false only once its backend is live & smoke-tested.
# Launch-critical modules — explicitly live (mockPolicy also forces live data
# in staging/production regardless; these keep dev/staging intent unambiguous).
EXPO_PUBLIC_REFERRAL_USE_MOCK=false
EXPO_PUBLIC_TRANSFERS_USE_MOCK=false
EXPO_PUBLIC_KYC_VERIFY_USE_MOCK=false
EXPO_PUBLIC_CRYPTO_USE_MOCK=false
EXPO_PUBLIC_FINANCE_USE_MOCK=false
EOF

echo
echo "Done. Review the generated files, then start each service."
echo "Reminder: master.env and all generated .env files are git-ignored."
