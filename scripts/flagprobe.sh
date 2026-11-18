#!/usr/bin/env bash
# flagprobe.sh — for every flag declared in a prod flag file, find a REAL gated
# route in the BFF source and report its live status code. Derives flag -> route
# from the code, never from a guessed URL slug. Run from a clean release checkout.
set -uo pipefail
HOST="${1:-www.spotlightng.com}"
FILE="${2:-frontend-web/config/production-module-flags.env}"
FF="frontend-web/src/lib/feature-flags.ts"
APIROOT="frontend-web/app/api"
DUMMY="00000000-0000-0000-0000-000000000000"
while IFS= read -r line; do
  case "$line" in ''|'#'*) continue ;; esac
  env_name="${line%%=*}"; env_val="${line#*=}"
  key="$(grep -E "\(\) =>" "$FF" | grep -F "envFlag('${env_name}')" | head -1 | sed -E 's/^ *([a-zA-Z0-9]+):.*/\1/')"
  [ -n "$key" ] || { printf '%-46s %-6s %s\n' "$env_name" "$env_val" "NO-KEY-IN-CODE"; continue; }
  # Two shapes reach a flag: the route file names it, or the route file calls a
  # wrapper that does. Missing the second shape once reported a live flag as
  # "no route" (utilityBillsGoProxy gates three real routes through
  # utilityGoProxyEnabled in app/api/v1/utility/_utils.ts).
  files="$(grep -rlE "featureFlags\.${key}([^a-zA-Z0-9_]|$)|requireFeature\('${key}'" "$APIROOT" 2>/dev/null | grep '/route.ts$')"
  for w in $(grep -rlE "featureFlags\.${key}([^a-zA-Z0-9_]|$)" "$APIROOT" 2>/dev/null | grep -v '/route.ts$'); do
    for fn in $(grep -oE "export (async )?function [a-zA-Z0-9_]+" "$w" | awk '{print $NF}'); do
      g="$(grep -rlE "\b${fn}\(" "$APIROOT" 2>/dev/null | grep '/route.ts$' | grep -v "$w")"
      [ -n "$g" ] && files="${files}
${g}"
    done
  done
  files="$(printf '%s\n' "$files" | grep -v '^$' | sort -u | head -3)"
  [ -n "$files" ] || { printf '%-46s %-6s %s (key=%s)\n' "$env_name" "$env_val" "NO-ROUTE-IN-app/api" "$key"; continue; }
  for f in $files; do
    url="${f#"$APIROOT"}"; url="${url%/route.ts}"
    url="$(printf '%s' "$url" | sed -E "s/\[+(\.\.\.)?[a-zA-Z0-9_]+\]+/${DUMMY}/g")"
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://${HOST}/api${url}")"
    printf '%-46s %-6s %-58s %s\n' "$env_name" "$env_val" "/api${url}" "$code"
  done
done < "$FILE"
