#!/usr/bin/env bash
# test-railway-deploy-retry.sh — prove scripts/ci/railway-deploy.sh rides out a
# transient Railway upload failure, and prove this test can still see it fail.
#
# WHY THIS EXISTS
# On 2026-11-16 `railway up` died 400 ms into the staging legs with
#     Failed to fetch: error decoding response body
#       0: error decoding response body
#       1: expected value at line 1 column 1
# (Railway's upload-initiate request answering with a non-JSON body), while the
# byte-identical command on the byte-identical pinned CLI succeeded 21 s earlier
# in the same job and 3611 ms later in another one. Nothing in the credential,
# the flags, the tree or the service decided it — the single-shot call did. One
# blip reddens every staging leg, and `smoke-staging` is the gate on production,
# so a blip on Railway's side reads as a broken release chain on ours.
#
# The repo already answers that class of fault for Docker Hub with
# scripts/ci/with-retry.sh. This test pins that the deploy script goes through it.
#
# HOW IT WORKS
# A stub `railway` on PATH plays both shapes: fail twice then succeed (the real
# window), and never succeed (the bound). Each assertion checks the exit code AND
# how many times `up` was invoked, because "exited 0" alone is also what a test
# reports when the retry was never reached. The permanent-failure case is the red
# control: a suite whose every case passes whatever the script does proves nothing.
#
# Run:  bash scripts/ci/test-railway-deploy-retry.sh
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$repo_root/scripts/ci/railway-deploy.sh"
SHA_STUB="000000000000000000000000000000000000000a"

command -v jq >/dev/null || { echo "FAIL: jq is required"; exit 1; }
[ -f "$script" ] || { echo "FAIL: $script missing"; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/tree/fake"

cat > "$work/bin/railway" <<'STUB'
#!/usr/bin/env bash
# Enough of the railway CLI for scripts/ci/railway-deploy.sh: `up`,
# `deployment list` and `logs`. STUB_MODE picks the behaviour:
#   transient     the first STUB_TRANSIENT_FAILS `up` calls fail with the exact
#                 decode error, later ones succeed
#   always-fail   every `up` call fails with it
#   shape         `up` records its argv and succeeds (empty-argument check)
cmd="${1:-}"; shift || true
case "$cmd" in
  up)
    if [ "${STUB_MODE}" = shape ]; then
      : > "$STUB_ARGV"
      for a in "$@"; do printf '<%s>\n' "$a" >> "$STUB_ARGV"; done
      exit 0
    fi
    n=0
    [ -f "$STUB_UP_COUNT" ] && n="$(cat "$STUB_UP_COUNT")"
    n=$((n + 1)); printf '%s' "$n" > "$STUB_UP_COUNT"
    if [ "${STUB_MODE}" = always-fail ] || [ "$n" -le "${STUB_TRANSIENT_FAILS:-2}" ]; then
      echo "Failed to fetch: error decoding response body" >&2
      echo "" >&2
      echo "Caused by:" >&2
      echo "    0: error decoding response body" >&2
      echo "    1: expected value at line 1 column 1" >&2
      exit 1
    fi
    echo "Indexing..."
    echo "Uploading..."
    echo "  Build Logs: https://railway.com/project/p/service/s?id=stub$n&"
    exit 0
    ;;
  deployment)
    printf '[{"id":"00000000-0000-0000-0000-000000000001","createdAt":"2026-11-16T00:00:00.000Z","status":"SUCCESS","meta":{"cliMessage":"%s"}}]' "$SHA_STUB"
    exit 0
    ;;
  logs)
    echo "stub deploy logs"
    exit 0
    ;;
  *)
    echo "stub railway: unexpected invocation: $cmd $*" >&2
    exit 1
    ;;
esac
STUB
chmod +x "$work/bin/railway"
export SHA_STUB
PATH="$work/bin:$PATH" bash -c 'command -v railway >/dev/null && railway deployment list --json >/dev/null' \
  || { echo "FAIL: the stub railway is not reachable on PATH"; exit 1; }

failures=0
check() { # <label> <expected> <actual>
  if [ "$2" = "$3" ]; then
    echo "PASS  $1"
  else
    echo "FAIL  $1 (expected [$2], got [$3])"
    failures=$((failures + 1))
  fi
}

# Run the real deploy script against the stub. $1 = mode, $2 = UPLOAD_PATH,
# $3 = ROOT_FLAG. Echoes "<exit-code> <up-invocations>".
run_deploy() {
  local mode="$1" up="$2" flag="$3" rc
  local counter="$work/up.$mode" out="$work/out.$mode"
  : > "$counter"
  (
    cd "$work/tree" || exit 99
    SERVICE=backend RAILWAY_ENV=staging SHA="$SHA_STUB" RAILWAY_TOKEN=stub-token \
    RAILWAY_PROJECT=stub-project UPLOAD_PATH="$up" ROOT_FLAG="$flag" \
    BUILD_DIR=fake ATTEMPTS=3 RETRY_ATTEMPTS=4 RETRY_BASE_DELAY_S=0 \
    STUB_MODE="$mode" STUB_UP_COUNT="$counter" STUB_ARGV="$work/argv" \
    PATH="$work/bin:$PATH" bash "$script"
  ) > "$out" 2>&1
  rc=$?
  printf '%s %s\n' "$rc" "$(cat "$counter")"
  cp "$out" "$work/last-out.$mode"
}

# --- 1. A blip is ridden out: fail twice, then the third attempt uploads. -------
read -r rc n <<<"$(run_deploy transient fake --path-as-root)"
check "transient blip: the script exits 0" "0" "$rc"
check 'transient blip: up ran 3 times (2 failures + 1 success)' "3" "$n"
grep -q '::warning::with-retry' "$work/last-out.transient" \
  && seen=yes || seen=no
check "transient blip: with-retry.sh is the thing that retried" "yes" "$seen"

# --- 2. The bound holds: a permanent failure stops, loudly. ---------------------
read -r rc n <<<"$(run_deploy always-fail fake --path-as-root)"
[ "$rc" -ne 0 ] && nonzero=yes || nonzero=no
check "permanent failure: the script exits non-zero" "yes" "$nonzero"
check 'permanent failure: up stopped at RETRY_ATTEMPTS=4' "4" "$n"
grep -q 'still failing after 4 attempts' "$work/last-out.always-fail" \
  && bounded=yes || bounded=no
check "permanent failure: the giving-up message names the bound" "yes" "$bounded"

# --- 3. Empty UPLOAD_PATH / ROOT_FLAG vanish instead of becoming "". -----------
# THE UPLOAD RULE in railway-deploy.sh depends on this: `railway up ""` reads a
# path of "", and the retry wrapper must not reintroduce the empty argument.
run_deploy shape '' '' >/dev/null
if [ -f "$work/argv" ]; then
  empties=$(grep -c '^<>$' "$work/argv")
  check "pathless shape: no empty-string argument reached the CLI" "0" "$empties"
  grep -q '^<--path-as-root>$' "$work/argv" && leaked=yes || leaked=no
  check "pathless shape: ROOT_FLAG='' did not leak its flag" "no" "$leaked"
else
  check "pathless shape: the stub recorded argv" "recorded" "missing"
fi

echo
if [ "$failures" -eq 0 ]; then
  echo "ok — the deploy upload retries a transient Railway failure and still stops"
  exit 0
fi
echo "$failures assertion(s) failed"
exit 1
