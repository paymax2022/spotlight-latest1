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
# Tunables (env): RETRY_ATTEMPTS (default 6), RETRY_BASE_DELAY_S (default 5),
# RETRY_NON_RETRYABLE (default unset = retry everything, as before). When set it is
# a case-insensitive ERE matched against an attempt's combined output: a match means
# "no amount of waiting fixes this" and the ladder stops at once, exit code preserved.
# It exists for refusals that report an ACCOUNT STATE, not a window — Railway's
# "Your trial has expired. Please select a plan" burned 9 attempts x 6 legs x ~18 min
# on 2026-11-19 while the real fix was a human with a credit card.
# Delays: 5s, 10s, 20s, 40s, 80s (+ jitter, capped at 120s) — ~4 min worst case,
# enough for a rate-limit window or a short auth-service blip to clear.
set -u

attempts="${RETRY_ATTEMPTS:-6}"
base_delay="${RETRY_BASE_DELAY_S:-5}"
non_retryable="${RETRY_NON_RETRYABLE:-}"
delay="$base_delay"
max_delay=120

# A bad ERE makes grep exit 2 and match nothing, which would turn the guard into a
# silent no-op. Refuse it loudly, then fall back to the retry-everything behaviour
# this script has always had.
if [ -n "$non_retryable" ]; then
  probe=0
  printf '' | grep -qiE "$non_retryable" >/dev/null 2>&1 || probe=$?
  if [ "$probe" -eq 2 ]; then
    echo "::warning::with-retry: RETRY_NON_RETRYABLE=/$non_retryable/ is not a valid ERE — ignoring it and retrying every failure" >&2
    non_retryable=""
  fi
fi

# Only when a pattern is set does an attempt get captured to a file: matching a
# message requires the whole attempt body, and the pattern-less default path stays
# byte-for-byte the streaming behaviour it always had (docker pulls included).
capture=""
if [ -n "$non_retryable" ]; then
  capture="$(mktemp "${TMPDIR:-/tmp}/with-retry.XXXXXX")"
  trap 'rm -f "$capture"' EXIT
fi

i=1
while :; do
  if [ -n "$capture" ]; then
    "$@" >"$capture" 2>&1
    rc=$?
    cat "$capture"          # the tool's own words still reach the log, verbatim
    [ "$rc" -eq 0 ] && exit 0
    if grep -qiE "$non_retryable" "$capture"; then
      echo "::error::with-retry: '$*' failed with a NON-RETRYABLE message (matched /$non_retryable/). Retrying cannot clear this — act on what it says above." >&2
      exit "$rc"
    fi
  else
    # `cmd && exit` keeps the command's own exit code in $? — an `if cmd; then`
    # would mask it, reporting the failing attempt as "exit 0".
    "$@" && exit 0
    rc=$?
  fi
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
