#!/usr/bin/env bash
# Read back what an environment is ACTUALLY serving. A green `railway up` proves a
# deployment reached SUCCESS; it does not prove the bytes changed, and for a
# frontend there is no commit echo to read at all.
#
# Required env:
#   SERVICE       backend | frontend-web | frontend-admin
#   RAILWAY_ENV   development | staging | production
#   SHA           the commit that should now be served
# Optional env:
#   REQUIRE_READYZ       'true' (default) makes a non-200 /readyz a FAILURE.
#                        Set 'false' for development: its backend /readyz answers
#                        503 today because its DB pool is unreachable — a
#                        pre-existing condition, unrelated to any release, and a
#                        hard requirement there would halt every release.
#   EXPECT_FINGERPRINT   the pre-deploy frontend digest. Compared, never required.
#   TOUCHED              'true' (default) — this commit changed the service's files,
#                        so an unchanged digest is worth a warning. 'false' means
#                        the digest is expected to be identical and no warning is
#                        emitted.
#   SUMMARY        defaults to $GITHUB_STEP_SUMMARY, else /dev/null

set -uo pipefail

: "${SERVICE:?required: SERVICE}"
: "${RAILWAY_ENV:?required: RAILWAY_ENV}"
: "${SHA:?required: SHA}"
REQUIRE_READYZ="${REQUIRE_READYZ:-true}"
EXPECT_FINGERPRINT="${EXPECT_FINGERPRINT:-}"
TOUCHED="${TOUCHED:-true}"
SUMMARY="${SUMMARY:-${GITHUB_STEP_SUMMARY:-/dev/null}}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Sourced, not copied: the URL table exists in exactly one file so the pre-deploy
# fingerprint and this post-deploy probe cannot disagree about the host.
. "$HERE/railway-urls.sh"

BASE="$(railway_url "$RAILWAY_ENV" "$SERVICE")"
if [ -z "$BASE" ]; then
  echo "::error::no URL recorded for $RAILWAY_ENV/$SERVICE in railway-urls.sh"
  exit 1
fi

note() { printf '%s\n' "$*" >> "$SUMMARY"; }

fail() {
  echo "::error::$*"
  note "- **$SERVICE / $RAILWAY_ENV** — FAILED: $*"
  exit 1
}

code() { curl -s -o /dev/null -w '%{http_code}' -m 30 -L "$1" || echo 000; }

note "### smoke: $SERVICE / $RAILWAY_ENV"
note "- host: $BASE"

case "$SERVICE" in
  backend)
    # POLL, do not read once: the deployment reports SUCCESS before the process has
    # necessarily finished booting (cold start measured at ~25s locally).
    served=""
    for attempt in $(seq 1 20); do
      body="$(curl -s -m 30 "$BASE/api/v1/public/build" || true)"
      served="$(printf '%s' "$body" | jq -r '.commit // empty' 2>/dev/null || true)"
      if [ "$served" = "$SHA" ]; then break; fi
      echo "  attempt $attempt/20 — serving ${served:-<nothing>}, want $SHA"
      sleep 15
    done
    # The build endpoint reports `source: "ldflags"` and the stamped BUILD_COMMIT.
    # If it echoes an older SHA the new image is not the one serving traffic, which
    # is the exact failure a green deployment can hide.
    [ "$served" = "$SHA" ] || fail "serving ${served:-<nothing>} after 5 minutes, expected $SHA"
    started="$(printf '%s' "$body" | jq -r '.started_at // empty' 2>/dev/null || true)"
    uptime="$(printf '%s' "$body" | jq -r '.uptime_seconds // empty' 2>/dev/null || true)"
    note "- served commit: \`$served\`"
    note "- process started: ${started:-unknown} (uptime ${uptime:-unknown}s)"
    echo "backend is serving $SHA (started ${started:-unknown})"

    [ "$(code "$BASE/healthz")" = 200 ] || fail "/healthz did not answer 200"
    note "- /healthz: 200"

    ready="$(code "$BASE/readyz")"
    if [ "$ready" = 200 ]; then
      note "- /readyz: 200"
    elif [ "$REQUIRE_READYZ" = true ]; then
      fail "/readyz answered $ready"
    else
      # Recorded, not failed. development's DB pool is unreachable today.
      echo "::warning::$RAILWAY_ENV backend /readyz answered $ready (not required in $RAILWAY_ENV)"
      note "- /readyz: $ready — warning only, not required in $RAILWAY_ENV"
    fi
    ;;

  frontend-web|frontend-admin)
    path="/"
    [ "$SERVICE" = frontend-admin ] && path="/admin/login"
    got="$(code "$BASE$path")"
    [ "$got" = 200 ] || fail "$path answered $got"
    note "- $path: 200"

    # A frontend echoes no commit, so the digest is the only available evidence.
    now="$(bash "$HERE/frontend-fingerprint.sh" "$BASE$path")"
    note "- chunk fingerprint: \`$now\`${EXPECT_FINGERPRINT:+ (was \`$EXPECT_FINGERPRINT\`)}"

    if [ -n "$EXPECT_FINGERPRINT" ] && [ "$now" = "$EXPECT_FINGERPRINT" ] && [ "$TOUCHED" = true ]; then
      # A WARNING, never a failure: an unchanged digest can also mean the commit
      # touched only server-side code, or that the CDN is still warm. But it must
      # be loud, because for production frontend-web it is the difference between
      # "released" and "still serving October's bytes" — and a mobile store build
      # bakes EXPO_PUBLIC_API_BASE_URL at submission time (eas.json:65), so it
      # cannot be re-pointed without a new submission.
      echo "::warning::$RAILWAY_ENV/$SERVICE still serves the SAME chunks as before this deploy (fingerprint $now). This commit touched $SERVICE's files, so the bytes should have changed."
      note "- **WARNING: the served chunks did not change** even though this commit touched \`$SERVICE\`."
    fi
    ;;

  *)
    fail "unknown service '$SERVICE' — railway-smoke.sh handles backend, frontend-web, frontend-admin"
    ;;
esac

note "- result: PASS"
echo "=== smoke PASS: $SERVICE/$RAILWAY_ENV ==="
