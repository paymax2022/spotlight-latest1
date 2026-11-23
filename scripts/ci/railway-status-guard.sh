#!/usr/bin/env bash
# railway-status-guard.sh — pre-flight for the ops upload lane: prove the token reaches
# the environment and service the operator NAMED, before any byte leaves the runner,
# while riding out a transient Railway read failure.
#
# TWO FACTS IT EXISTS FOR
#
# 1. It is a safety gate. `deploy-railway-action.yml` and this lane both check the status
#    body first so that a mis-set RAILWAY_TOKEN_<ENV> cannot upload to a place the
#    operator did not choose. That check must stay a refusal, not a warning: a token that
#    reads fine but names `development` when `production` was requested has to stop the
#    run (see the D/E cases in scripts/ci/test-railway-status-guard.sh).
#
# 2. The call was single-shot, and that cost a dispatch. Run `45179114945` (job
#    `137707997676`, 2026-11-23 ~12:53Z) died here with Railway's decode body
#       Failed to fetch: error decoding response body
#         0: error decoding response body
#         1: expected value at line 1 column 1
#    and never packed an archive. Eight minutes later run `45179580758` (job
#    `137709644373`, 13:01:27Z) ran the same command, same secret
#    (RAILWAY_TOKEN_STAGING), same pinned CLI (5.40.1), unlinked runner directory, and
#    printed `rc=0 bytes=52349 verdict=decoded`. So the fault is a window, not a
#    credential — which is also the conclusion docs/ops/railway-f2-token-probe.md records
#    for the 13:01Z transport cells ("The sampler, not the token").
#
# The lane's upload call already goes through scripts/ci/with-retry.sh
# (scripts/ci/railway-deploy.sh, pinned by test-railway-deploy-retry.sh). This script
# gives the same treatment to the one Railway read that was left bare, with two changes
# suited to a status body rather than an upload: an attempt counts as failed unless the
# body PARSES and names at least one environment (Railway has answered 200-with-nothing
# before), and the fail-fast pattern includes `Not Authorized`, because that is a scope
# answer that no amount of waiting changes — retrying it would hide a misplaced secret
# behind four slow failures.
#
# Usage:  ENVIRONMENT=production SERVICE=frontend-web scripts/ci/railway-status-guard.sh
# Env:    STATUS_OUT          where to write the body (default /tmp/railway-status.json)
#         STATUS_ATTEMPTS     tries before giving up (default 5)
#         STATUS_BASE_DELAY_S first backoff (default 5; doubling, capped 120, +/-50%)
#         RETRY_NON_RETRYABLE ERE that means "not a window" (default below)
# Exit:   0  the token resolved ENVIRONMENT and SERVICE, body left at $STATUS_OUT
#         1  it did not — the caller must not upload
set -uo pipefail

environment="${ENVIRONMENT:-}"
service="${SERVICE:-}"
out="${STATUS_OUT:-/tmp/railway-status.json}"
attempts="${STATUS_ATTEMPTS:-5}"
base_delay="${STATUS_BASE_DELAY_S:-5}"
non_retryable="${RETRY_NON_RETRYABLE:-trial has expired|please select a plan|Not Authorized}"
max_delay=120

if [ -z "$environment" ] || [ -z "$service" ]; then
  echo "::error::railway-status-guard: ENVIRONMENT and SERVICE are required" >&2
  exit 1
fi
command -v jq >/dev/null || { echo "::error::railway-status-guard: jq is required" >&2; exit 1; }

# A bad ERE makes grep exit 2 and match nothing, which would silently turn the fail-fast
# guard off. Same handling with-retry.sh uses: warn, then retry everything.
if [ -n "$non_retryable" ]; then
  probe=0
  printf '' | grep -qiE "$non_retryable" >/dev/null 2>&1 || probe=$?
  if [ "$probe" -eq 2 ]; then
    echo "::warning::railway-status-guard: RETRY_NON_RETRYABLE=/$non_retryable/ is not a valid ERE — ignoring it" >&2
    non_retryable=""
  fi
fi

# One attempt: the body parses AND names at least one environment. `railway status` has
# exited 0 on an empty stdout, which the old inline step read as "no environments" and
# refused; here it reads as what it is — an unanswered question worth asking again.
attempt_once() {
  local body err rc names
  err="$(mktemp "${TMPDIR:-/tmp}/railway-status-err.XXXXXX")"
  body="$(railway status --json 2>"$err")"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    printf '%s\n%s\n' "$body" "$(cat "$err")" > "$out.attempt"
    rm -f "$err"
    return "$rc"
  fi
  rm -f "$err"
  printf '%s' "$body" > "$out"
  if ! printf '%s' "$body" | jq -e . >/dev/null 2>&1; then
    printf 'unparseable status body (%s bytes)\n' "${#body}" > "$out.attempt"
    return 1
  fi
  names="$(printf '%s' "$body" | jq -r '[.environments.edges[]?.node.name] | map(select(. != null)) | join(",")' 2>/dev/null)"
  if [ -z "$names" ]; then
    printf 'status body parsed but named no environments\n' > "$out.attempt"
    return 1
  fi
  printf '%s\n' "$names" > "$out.attempt.names"
  return 0
}

delay="$base_delay"
rc=1
last_note="no attempt ran"
i=1
while :; do
  if attempt_once; then
    rc=0
    break
  fi
  rc=$?
  last_note="$(cat "$out.attempt" 2>/dev/null || echo 'railway status exited non-zero')"
  if [ -n "$non_retryable" ] && grep -qiE "$non_retryable" "$out.attempt" 2>/dev/null; then
    echo "::error::railway-status-guard: attempt $i answered something that is not a window (matched /$non_retryable/): $last_note" >&2
    echo "::error::railway-status-guard: this is a credential-scope or account-state answer — rotating or paying fixes it, waiting does not. Refusing to deploy." >&2
    rm -f "$out.attempt"
    exit 1
  fi
  if [ "$i" -ge "$attempts" ]; then
    echo "::error::railway-status-guard: railway status still unusable after $attempts attempts (exit $rc): $last_note" >&2
    rm -f "$out.attempt"
    exit 1
  fi
  jitter=$((RANDOM % (delay / 2 + 1)))
  sleep_s=$((delay + jitter))
  echo "::warning::railway-status-guard: attempt $i/$attempts unusable ($last_note); retrying in ${sleep_s}s" >&2
  sleep "$sleep_s"
  delay=$((delay * 2)); [ "$delay" -gt "$max_delay" ] && delay=$max_delay
  i=$((i + 1))
done
rm -f "$out.attempt" "$out.attempt.names"
echo "  status decoded on attempt $i ($(wc -c < "$out" | tr -d ' ') bytes)"

envs="$(jq -r '[.environments.edges[]?.node.name] | map(select(. != null)) | unique | .[]' "$out" 2>/dev/null)"
if ! printf '%s\n' "$envs" | grep -qx "$environment"; then
  echo "::error::the $environment token resolves environments [$(printf '%s' "$envs" | paste -sd, -)]; refusing to deploy" >&2
  exit 1
fi
svcs="$(jq -r --arg env "$environment" '
  [.environments.edges[] | select(.node.name == $env)
   | .node.serviceInstances.edges[]?.node.serviceName] | map(select(. != null)) | unique | .[]' "$out" 2>/dev/null)"
if ! printf '%s\n' "$svcs" | grep -qx "$service"; then
  echo "::error::service $service not found in $environment (found: $(printf '%s' "$svcs" | paste -sd, -))" >&2
  exit 1
fi
echo "  token resolves $ENVIRONMENT / $SERVICE"
