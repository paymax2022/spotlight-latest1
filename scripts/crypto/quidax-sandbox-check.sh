#!/usr/bin/env bash
# Read-only Quidax sandbox check for the cryptoprov/quidax adapter (PR #704).
# Moves no value: GET reads, plus one swap QUOTE (a quote never executes).
#
#   railway run --service <backend-service> -- scripts/crypto/quidax-sandbox-check.sh
#   (or export QUIDAX_TEST_API_KEY yourself, then run it)
#
# The key is read from the environment, passed to curl through a config file
# descriptor (never argv), and scrubbed from all output. Paste the output back;
# it contains no secret.
set -uo pipefail
KEY="${QUIDAX_TEST_API_KEY:-${QUIDAX_API_KEY:-${QUIDAX_SECRET_KEY:-}}}"
[ -n "$KEY" ] || { echo "Set QUIDAX_TEST_API_KEY (sandbox key) first."; exit 1; }
BASES=("${QUIDAX_TEST_BASE_URL:-}" "https://app.quidax.io/api/v1" "https://openapi.quidax.io/exchange-open-api/api/v1")

scrub() { sed "s/$KEY/<KEY>/g"; }
get()  { curl -sS -m 20 -w '\nHTTP %{http_code}\n' --config <(printf 'header = "Authorization: Bearer %s"\n' "$KEY") "$@" 2>&1 | scrub; }
post() { curl -sS -m 20 -w '\nHTTP %{http_code}\n' -X POST -H 'Content-Type: application/json' --config <(printf 'header = "Authorization: Bearer %s"\n' "$KEY") "$@" 2>&1 | scrub; }
trunc() { head -c 700; echo; }

echo "### 1. Which base URL authenticates (GET /users/me)"
WORKING=""
for B in "${BASES[@]}"; do
  [ -n "$B" ] || continue
  OUT=$(get "$B/users/me"); CODE=$(echo "$OUT" | tail -1)
  echo "$B -> $CODE"
  if [ "$CODE" = "HTTP 200" ] && [ -z "$WORKING" ]; then WORKING="$B"; echo "$OUT" | sed '$d' | trunc; fi
done
[ -n "$WORKING" ] || { echo "No base URL accepted the key. Stop."; exit 2; }
echo "USING: $WORKING"

echo; echo "### 2. Ticker shape (adapter expects data.ticker.last)"
get "$WORKING/markets/tickers/usdtngn" | trunc
get "$WORKING/markets/tickers/btcngn" | trunc

echo; echo "### 3. Wallets shape + response headers (rate-limit headers)"
get "$WORKING/users/me/wallets" | trunc
curl -sS -m 20 -D - -o /dev/null --config <(printf 'header = "Authorization: Bearer %s"\n' "$KEY") "$WORKING/markets/tickers/usdtngn" 2>&1 | scrub | grep -iE "^(HTTP|x-rate|ratelimit|retry-after|x-request)" 

echo; echo "### 4. Swap quote (no execution): field names, expiry format, id"
post "$WORKING/users/me/swap_quotation" -d '{"from_currency":"usdt","to_currency":"ngn","from_amount":"1"}' | trunc

echo; echo "### 5. Not-found / error body shape (adapter reads message+code)"
get "$WORKING/users/me/withdraws/does-not-exist" | trunc
get "$WORKING/users/me/swap_transactions/does-not-exist" | trunc

echo; echo "### Webhooks (cannot be checked by polling)"
echo "Event name + signature header + timestamp unit only show up in a real delivery."
echo "Point the sandbox webhook at a request-capture URL, trigger one swap, and paste the"
echo "event JSON and the signature header NAME and timestamp digit-count (not the secret)."
