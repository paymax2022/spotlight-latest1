#!/usr/bin/env bash
# Create ONE Alpaca Broker API *sandbox* account and print its id, so you can set
# ALPACA_ACCOUNT_ID in .env and let the backend place orders end-to-end.
#
# Usage (from mobile-app/reactnative/backend):
#   bash scripts/alpaca-sandbox-account.sh
#
# It reads ALPACA_BASE_URL / ALPACA_API_KEY / ALPACA_API_SECRET from .env (or the
# environment). Email + tax id are randomized so re-runs don't collide. SANDBOX ONLY.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$here/.env" ]]; then
  set -a; # export everything sourced
  # shellcheck disable=SC1090
  source "$here/.env"
  set +a
fi

: "${ALPACA_BASE_URL:?set ALPACA_BASE_URL in .env}"
: "${ALPACA_API_KEY:?set ALPACA_API_KEY in .env}"
: "${ALPACA_API_SECRET:?set ALPACA_API_SECRET in .env}"

rand=$RANDOM$RANDOM
ssn_last4=$(printf "%04d" $((RANDOM % 10000)))
email="paymax.test+${rand}@example.com"

read -r -d '' body <<JSON || true
{
  "contact": {
    "email_address": "${email}",
    "phone_number": "+15556667788",
    "street_address": ["20 N San Mateo Dr"],
    "city": "San Mateo",
    "state": "CA",
    "postal_code": "94401",
    "country": "USA"
  },
  "identity": {
    "given_name": "Paymax",
    "family_name": "Sandbox",
    "date_of_birth": "1990-01-01",
    "tax_id": "666-55-${ssn_last4}",
    "tax_id_type": "USA_SSN",
    "country_of_citizenship": "USA",
    "country_of_birth": "USA",
    "country_of_tax_residence": "USA",
    "funding_source": ["employment_income"]
  },
  "disclosures": {
    "is_control_person": false,
    "is_affiliated_exchange_or_finra": false,
    "is_politically_exposed": false,
    "immediate_family_exposed": false
  },
  "agreements": [
    { "agreement": "customer_agreement", "signed_at": "2020-09-11T18:13:44Z", "ip_address": "185.13.21.99" },
    { "agreement": "account_agreement",  "signed_at": "2020-09-11T18:13:44Z", "ip_address": "185.13.21.99" }
  ]
}
JSON

echo "Creating sandbox account at ${ALPACA_BASE_URL}/v1/accounts ..."
resp=$(curl -sS -u "${ALPACA_API_KEY}:${ALPACA_API_SECRET}" \
  -X POST "${ALPACA_BASE_URL}/v1/accounts" \
  -H 'Content-Type: application/json' \
  -d "${body}")

echo "$resp"

# Extract the account id (prefer python/jq if available, else grep).
acct=""
if command -v python3 >/dev/null 2>&1; then
  acct=$(printf '%s' "$resp" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))' 2>/dev/null || true)
fi
if [[ -z "$acct" ]] && command -v jq >/dev/null 2>&1; then
  acct=$(printf '%s' "$resp" | jq -r '.id // empty' 2>/dev/null || true)
fi

echo
if [[ -n "$acct" ]]; then
  echo "✅ account id: $acct"
  echo "   Add this line to $here/.env :"
  echo "   ALPACA_ACCOUNT_ID=$acct"
else
  echo "⚠️  Could not parse an account id from the response above."
  echo "   If it shows an error, read the message (a duplicate tax_id/email just needs a re-run)."
fi
