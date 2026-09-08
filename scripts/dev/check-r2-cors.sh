#!/usr/bin/env bash
#
# Does the R2 bucket allow browser uploads?
#
# Replays the CORS preflight the browser sends before a presigned PUT. This is
# the check `curl -X PUT` cannot do: curl sends no preflight, so a direct PUT
# succeeds from the terminal while the browser fails with net::ERR_FAILED and no
# HTTP status at all.
#
#   scripts/dev/check-r2-cors.sh [origin]
#
# Reads the endpoint and bucket from backend/.env. Sends no credentials — a
# preflight is unauthenticated by design.
set -euo pipefail

ORIGIN="${1:-http://localhost:8083}"
ENVF="$(git rev-parse --show-toplevel)/backend/.env"
[ -f "$ENVF" ] || { echo "error: $ENVF not found" >&2; exit 2; }

get() { grep -m1 "^$1=" "$ENVF" | cut -d= -f2- | tr -d '"'"'"; }
EP=$(get R2_ACCOUNT_ENDPOINT); BK=$(get R2_BUCKET)
[ -n "$EP" ] && [ -n "$BK" ] || { echo "error: R2_ACCOUNT_ENDPOINT / R2_BUCKET not set in backend/.env" >&2; exit 2; }

URL="${EP%/}/$BK/association/logo/_preflight_probe.png"
echo "bucket : $BK"
echo "origin : $ORIGIN"
echo

HDRS=$(curl -s -o /dev/null -D - -X OPTIONS "$URL" \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type" || true)

CODE=$(printf '%s' "$HDRS" | head -1 | awk '{print $2}')
ALLOW=$(printf '%s' "$HDRS" | grep -i '^access-control-allow-origin:' | head -1 | cut -d' ' -f2- | tr -d '\r' || true)
METH=$(printf '%s' "$HDRS"  | grep -i '^access-control-allow-methods:' | head -1 | cut -d' ' -f2- | tr -d '\r' || true)

echo "preflight status        : ${CODE:-<none>}"
echo "allow-origin            : ${ALLOW:-<absent>}"
echo "allow-methods           : ${METH:-<absent>}"
echo

if [ -z "$ALLOW" ]; then
  echo "RESULT: browser uploads will FAIL (net::ERR_FAILED)."
  echo "        The bucket has no CORS rule for this origin."
  echo "        Apply launch/r2-cors.json — see launch/R2-CORS.md."
  exit 1
fi
case "$METH" in
  *PUT*) echo "RESULT: preflight passes and PUT is allowed — browser uploads should work." ;;
  *)     echo "RESULT: origin is allowed but PUT is not in allow-methods — uploads will still fail."; exit 1 ;;
esac
