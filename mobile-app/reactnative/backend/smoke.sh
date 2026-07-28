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
say "readiness";             curl -fsS "$BASE/readyz"; echo
say "webhook (dev: unsigned accepted)";
                              curl -fsS -X POST "$BASE/api/v1/crypto/webhooks/mock" \
                                -H 'Content-Type: application/json' \
                                -d '{"id":"evt_smoke_1","type":"order.filled"}'; echo
say "webhook replay (same id → duplicate)";
                              curl -fsS -X POST "$BASE/api/v1/crypto/webhooks/mock" \
                                -H 'Content-Type: application/json' \
                                -d '{"id":"evt_smoke_1","type":"order.filled"}'; echo
say "webhook deposit.confirmed (credits 100 USDT)";
                              curl -fsS -X POST "$BASE/api/v1/crypto/webhooks/mock" \
                                -H 'Content-Type: application/json' \
                                -d '{"id":"evt_dep_1","type":"deposit.confirmed","data":{"symbol":"USDT","amount":100000000,"fiatValue":16050000}}'; echo
say "USDT deposit now in history";
                              curl -fsS "$BASE/api/v1/crypto/transactions" | grep -o '"side":"deposit"' | head -1

say "stocks list (count)";   curl -fsS "$BASE/api/v1/stocks" | grep -o '"symbol"' | wc -l
say "stock detail GTCO";     curl -fsS "$BASE/api/v1/stocks/GTCO" | head -c 180; echo
say "stock portfolio";       curl -fsS "$BASE/api/v1/portfolio?assetType=stock" | head -c 200; echo
say "stock orders";          curl -fsS "$BASE/api/v1/stocks/orders" | grep -o '"reference"' | wc -l
say "public offers";         curl -fsS "$BASE/api/v1/stocks/offers" | grep -o '"symbol"' | wc -l

say "admin dashboard";      curl -fsS "$BASE/api/v1/admin/dashboard" | head -c 200; echo
say "admin assets (count)";  curl -fsS "$BASE/api/v1/admin/assets" | grep -o '"symbol"' | wc -l
say "admin RBAC: SupportAdmin cannot toggle asset (expect 403)";
                              curl -s -o /dev/null -w "%{http_code}\n" -X PATCH "$BASE/api/v1/admin/assets/ast_btc" \
                                -H 'X-Admin-Role: SupportAdmin' -H 'Content-Type: application/json' -d '{"buyEnabled":false,"reason":"smoke"}'
say "admin maker-checker: ProductAdmin disable → pending approval";
                              curl -s -o /dev/null -w "%{http_code}\n" -X PATCH "$BASE/api/v1/admin/assets/ast_btc" \
                                -H 'X-Admin-Role: ProductAdmin' -H 'Content-Type: application/json' -d '{"buyEnabled":false,"reason":"smoke maker"}'
say "admin approvals queue";  curl -fsS "$BASE/api/v1/admin/approvals" | head -c 160; echo
say "admin audit log";        curl -fsS "$BASE/api/v1/admin/audit" | grep -o '"action"' | wc -l

say "reconciliation (ledger vs holdings)";
                              curl -fsS "$BASE/api/v1/crypto/admin/reconciliation" | head -c 200; echo
say "prometheus metrics";    curl -fsS "$BASE/metrics" | grep -E "crypto_requests_total|crypto_request_duration_seconds_count" | head -3

printf "\n\033[32mAll smoke checks passed.\033[0m\n"
