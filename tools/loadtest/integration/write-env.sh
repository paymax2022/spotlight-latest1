#!/usr/bin/env bash
# Generates backend/.env and frontend-web/.env.local for the local integration
# stack. Keys are pulled from `npx supabase status -o env` — nothing secret is
# embedded in this file. Skips files that already exist unless FORCE=1.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

REDIS_PORT="${REDIS_PORT:-6380}"

# shellcheck disable=SC2046
export $(cd supabase && npx --yes supabase status -o env | xargs)

: "${API_URL:?supabase status failed — is the local stack up?}"
: "${SERVICE_ROLE_KEY:?}"
: "${ANON_KEY:?}"

# Must match the fakes' default (FAKE_WEBHOOK_SECRET unset → "dev-fake-secret").
FAKE_SECRET="dev-fake-secret"

if [ ! -f backend/.env ] || [ "${FORCE:-0}" = "1" ]; then
cat > backend/.env <<EOF
APP_ENV=development
APP_PORT=8080
DATABASE_URL=postgres://postgres:postgres@localhost:54322/postgres?sslmode=disable
REDIS_URL=redis://localhost:${REDIS_PORT}
SUPABASE_URL=${API_URL}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
ADMIN_API_KEY=local-admin-key
CORS_ALLOW_ORIGINS=http://localhost:3000,http://localhost:3001
TRUSTED_PROXY_CIDRS=none
RAILS_MODE=fake
BNPL_BASE_URL=http://localhost:9100
BNPL_WEBHOOK_SECRET=${FAKE_SECRET}
PAYOUT_BASE_URL=http://localhost:9100
PAYOUT_WEBHOOK_SECRET=${FAKE_SECRET}
DISBURSE_BASE_URL=http://localhost:9100
DISBURSE_WEBHOOK_SECRET=${FAKE_SECRET}
BILLING_BASE_URL=http://localhost:9100
BILLING_WEBHOOK_SECRET=${FAKE_SECRET}
PAYMAX_WEBHOOK_SECRET=${FAKE_SECRET}
PAYSTACK_SECRET_KEY=replace-with-paystack-test-secret
PAYSTACK_WEBHOOK_SECRET=${FAKE_SECRET}
CRYPTO_PROVIDER=fake
FEATURE_WALLET_ENABLED=true
FEATURE_REFERRALS_ENABLED=true
FEATURE_REFERRAL_REWARDS_ENABLED=true
FEATURE_ACADEMY_ENABLED=true
EOF
  echo "wrote backend/.env"
else
  echo "backend/.env exists (FORCE=1 to overwrite)"
fi

if [ ! -f frontend-web/.env.local ] || [ "${FORCE:-0}" = "1" ]; then
cat > frontend-web/.env.local <<EOF
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
GO_BACKEND_URL=http://localhost:8080
NEXT_PUBLIC_SUPABASE_URL=${API_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
SUPABASE_URL=${API_URL}
SPOTLIGHT_ADMIN_API_KEY=local-admin-key
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=replace-with-paystack-test-key
PAYSTACK_SECRET_KEY=replace-with-paystack-test-secret
PAYSTACK_WEBHOOK_SECRET=${FAKE_SECRET}
RESEND_API_KEY=placeholder
EMAIL_FROM=test@localhost
CONTACT_INBOX_EMAIL=test@localhost
EOF
  echo "wrote frontend-web/.env.local"
else
  echo "frontend-web/.env.local exists (FORCE=1 to overwrite)"
fi
