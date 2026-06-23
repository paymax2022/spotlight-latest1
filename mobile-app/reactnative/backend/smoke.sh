#!/usr/bin/env bash
# Smoke test for the Paymax Invest · Crypto API.
# Usage:  (terminal 1) cd backend && go run ./cmd/server
#         (terminal 2) cd backend && ./smoke.sh
set -euo pipefail
BASE="${BASE:-http://localhost:8080}"

say() { printf "\n\033[1m== %s\033[0m\n" "$1"; }

say "health";                 curl -fsS "$BASE/healthz"; echo
say "eligibility";            curl -fsS "$BASE/api/v1/invest/eligibility"; echo
say "assets (count)";         curl -fsS "$BASE/api/v1/crypto/assets" | grep -o '"symbol"' | wc -l
say "BTC detail";             curl -fsS "$BASE/api/v1/crypto/assets/BTC" | head -c 200; echo
say "BTC chart (1D points)";  curl -fsS "$BASE/api/v1/crypto/assets/BTC/chart?range=1D" | grep -o '"t"' | wc -l
say "portfolio";              curl -fsS "$BASE/api/v1/portfolio" | head -c 220; echo
say "buy BTC ₦20,000";        curl -fsS -X POST "$BASE/api/v1/crypto/buy" \
                                -H 'Idempotency-Key: smoke-buy-1' -H 'Content-Type: application/json' \
                                -d '{"assetId":"ast_btc","side":"buy","basis":"fiat","fiat":{"amount":2000000,"currency":"NGN"},"crypto":{"amount":0,"symbol":"BTC"},"totalFiat":{"amount":2000000,"currency":"NGN"}}' \
                                | head -c 260; echo
say "buy replay (idempotent — same reference)";
                              curl -fsS -X POST "$BASE/api/v1/crypto/buy" \
                                -H 'Idempotency-Key: smoke-buy-1' -H 'Content-Type: application/json' \
                                -d '{"assetId":"ast_btc","side":"buy","basis":"fiat","fiat":{"amount":2000000,"currency":"NGN"},"crypto":{"amount":0,"symbol":"BTC"},"totalFiat":{"amount":2000000,"currency":"NGN"}}' \
                                | grep -o '"reference":"[^"]*"'
say "swap quote BTC→USDT";    curl -fsS -X POST "$BASE/api/v1/crypto/quote" \
                                -H 'Content-Type: application/json' \
                                -d '{"side":"swap","fromAssetId":"ast_btc","toAssetId":"ast_usdt","fromAmount":100000}' | head -c 220; echo
say "withdrawal eligibility"; curl -fsS "$BASE/api/v1/crypto/withdrawals/eligibility" | head -c 200; echo
say "deposit address USDT/tron"; curl -fsS "$BASE/api/v1/crypto/deposit-address?symbol=USDT&network=tron" | head -c 220; echo

printf "\n\033[32mAll smoke checks passed.\033[0m\n"
