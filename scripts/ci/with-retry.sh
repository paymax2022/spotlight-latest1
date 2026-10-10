#!/usr/bin/env bash
# with-retry.sh — run a command with bounded retries + exponential backoff.
#
# Exists for Docker Hub degradation: anonymous pulls from hosted runners share
# one egress IP pool, so ~10 concurrent PRs exhaust the anonymous rate limit and
# a bare `docker pull` / `docker build` dies on a transient 429 Too Many
# Requests or an auth.docker.io 500/504. Retrying the same command rides out
# the window; when the registry is healthy the first attempt succeeds and
# behaviour is identical to running the command directly.
#
# Usage:  scripts/ci/with-retry.sh <cmd> [args...]
#   e.g.  SHA=$GITHUB_SHA scripts/ci/with-retry.sh make docker-build
#         scripts/ci/with-retry.sh docker pull postgis/postgis:17-3.4
#
# Tunables (env): RETRY_ATTEMPTS (default 6), RETRY_BASE_DELAY_S (default 5).
# Delays: 5s, 10s, 20s, 40s, 80s (+ jitter, capped at 120s) — ~4 min worst case,
# enough for a rate-limit window or a short auth-service blip to clear.
set -u

attempts="${RETRY_ATTEMPTS:-6}"
base_delay="${RETRY_BASE_DELAY_S:-5}"
delay="$base_delay"
max_delay=120

i=1
while :; do
  # `cmd && exit` keeps the command's own exit code in $? — an `if cmd; then`
  # would mask it, reporting the failing attempt as "exit 0".
  "$@" && exit 0
  rc=$?
  if [ "$i" -ge "$attempts" ]; then
    echo "::error::with-retry: '$*' still failing after $attempts attempts (last exit $rc)" >&2
    exit "$rc"
  fi
  # ±50% jitter so concurrent jobs on the same window do not retry in lockstep.
  jitter=$((RANDOM % (delay / 2 + 1)))
  sleep_s=$((delay + jitter))
  echo "::warning::with-retry: attempt $i/$attempts failed (exit $rc); retrying in ${sleep_s}s — $*" >&2
  sleep "$sleep_s"
  delay=$((delay * 2)); [ "$delay" -gt "$max_delay" ] && delay=$max_delay
  i=$((i + 1))
done
