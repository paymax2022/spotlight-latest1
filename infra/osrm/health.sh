#!/usr/bin/env bash
# OSRM liveness probe: a tiny Lagos route must return code "Ok".
# Exit 0 = healthy, non-zero = unhealthy (used by refresh rollback + monitoring).
set -euo pipefail
BASE="${MAPS_OSRM_BASE_URL:-http://127.0.0.1:5000}"
# Ikoyi → Victoria Island
URL="$BASE/route/v1/driving/3.4350,6.4500;3.4220,6.4280?overview=false"
out="$(curl -fsS --max-time 5 "$URL" || true)"
if echo "$out" | grep -q '"code":"Ok"'; then
  echo "OSRM healthy ($BASE)"
  exit 0
fi
echo "OSRM UNHEALTHY ($BASE): ${out:0:200}" >&2
exit 1
