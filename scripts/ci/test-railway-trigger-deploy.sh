#!/usr/bin/env bash
# test-railway-trigger-deploy.sh — prove scripts/ci/railway-trigger-deploy.sh only
# calls a staging deploy done when a NEW row carrying THIS commit reached SUCCESS and
# the instance serves it, and prove this test can still see it fail.
#
# WHY THIS EXISTS
# The trigger lane replaced the staging upload because the upload initiate refuses
# intermittently in CI (docs/devops/railway-upload-fault-report.md, F2). It is a
# different transport with different answers, so every selector in it had to be
# re-derived from a real response rather than carried over. Two of those derivations
# were wrong on the first try, both silently:
#   * `railway deployment list --json` returns only `createdAt id meta status`
#     (measured against the live project on 2026-11-18). The `gmtCreate` field the
#     GraphQL layer exposes is ABSENT, so a first draft that filtered new rows by
#     timestamp matched nothing for nine minutes — while the row it was waiting for
#     had reached SUCCESS in ninety seconds. A poll that never finds its row looks
#     identical to a deploy that never happened, which is the failure mode this lane
#     was adopted to escape.
#   * A git-connected row has `meta.cliMessage: null` and puts its commit in
#     `meta.commitHash`. The upload lane's selector (`select(.meta.cliMessage == $m)`)
#     would time out here even on a successful deploy.
# Both are pinned below by shape: the stub returns the observed CLI field set, and
# the assertions count stub calls rather than reading the clock.
#
# The declined, refused, wrong-commit, failed-row and wrong-build cases are the red
# controls — a suite that passes whatever the script does proves nothing.
#
# Run:  bash scripts/ci/test-railway-trigger-deploy.sh
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$repo_root/scripts/ci/railway-trigger-deploy.sh"
SHA_STUB="000000000000000000000000000000000000000a"
SHA_OTHER="999999999999999999999999999999999999999b"
OLD_ID="aaaaaaaa-0000-0000-0000-000000000001"
NEW_ID="bbbbbbbb-0000-0000-0000-000000000002"

command -v jq >/dev/null || { echo "FAIL: jq is required"; exit 1; }
[ -f "$script" ] || { echo "FAIL: $script missing"; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"

# ── stub `railway`: the api mutation, the deployment list, the crash log ───────
# STUB_MODE picks the behaviour:
#   ok          api → data=true; the list starts as the single OLD row (which
#               already carries SHA_STUB — the re-run trap) and gains the NEW row
#               from the second list call onwards, status SUCCESS
#   api-error   api exits 1 with the F2-shaped decode text
#   api-false   api exits 0 and returns data=false — declined, no row will appear
#   bad-commit  the NEW row is SUCCESS but carries SHA_OTHER
#   row-failed  the NEW row ends FAILED
# Field set is the observed one: createdAt / id / meta / status. No gmtCreate, no
# snapshotId — a script that reaches for either cannot match here.
cat > "$work/bin/railway" <<STUB
#!/usr/bin/env bash
mode="\${STUB_MODE}"
old="{\"id\":\"${OLD_ID}\",\"createdAt\":\"2026-11-18T18:00:00.000Z\",\"status\":\"REMOVED\",\"meta\":{\"cliMessage\":null,\"commitHash\":\"\$SHA_STUB\",\"branch\":\"main\"}}"
new_status=SUCCESS
new_commit="\${SHA_STUB}"
[ "\$mode" = bad-commit ] && new_commit="\${SHA_OTHER}"
[ "\$mode" = row-failed ] && new_status=FAILED
bump() { # <counter-file>
  local c=0
  [ -f "\$1" ] && c="\$(cat "\$1")"
  c=\$((c + 1)); printf '%s' "\$c" > "\$1"
  printf '%s' "\$c"
}
case "\${1:-}" in
  api)
    n="\$(bump "\$STUB_API_COUNT")"
    case "\$mode" in
      api-error) echo "Failed to fetch: error decoding response body" >&2; exit 1 ;;
      api-false) printf '{\n  "data": {\n    "serviceInstanceDeploy": false\n  }\n}\n'; exit 0 ;;
    esac
    printf '{\n  "data": {\n    "serviceInstanceDeploy": true\n  }\n}\n'; exit 0
    ;;
  deployment)
    n="\$(bump "\$STUB_LIST_COUNT")"
    if [ "\$n" -gt "\${STUB_NEW_AFTER:-1}" ]; then
      printf '[%s,{"id":"${NEW_ID}","createdAt":"2026-11-18T21:54:39.000Z","status":"%s","meta":{"cliMessage":null,"commitHash":"%s","branch":"main"}}]' "\$old" "\$new_status" "\$new_commit"
    else
      printf '[%s]' "\$old"
    fi
    exit 0
    ;;
  logs)
    echo "stub deploy logs: nothing listening yet"
    exit 0
    ;;
  *)
    echo "stub railway: unexpected invocation: \$*" >&2; exit 1 ;;
esac
STUB

# `curl` plays the public build endpoint; `sleep` is stubbed so the poll costs
# nothing, and the assertions read counters instead of the clock.
cat > "$work/bin/curl" <<'CURL'
#!/usr/bin/env bash
if [ "${STUB_MODE}" = wrong-build ]; then
  printf '{"commit":"%s","source":"env","started_at":"2026-11-18T21:54:39Z"}' "$SHA_OTHER"
else
  printf '{"commit":"%s","source":"env","started_at":"2026-11-18T21:54:39Z"}' "$SHA_STUB"
fi
CURL
printf '#!/usr/bin/env bash\nexit 0\n' > "$work/bin/sleep"
chmod +x "$work/bin/railway" "$work/bin/curl" "$work/bin/sleep"
export SHA_STUB SHA_OTHER

failures=0
check() { # <label> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "PASS  $1"; else
    echo "FAIL  $1 (expected [$2], got [$3])"; failures=$((failures + 1));
  fi
}

# run_trigger <mode> -> "<exit> <api-calls> <list-calls>"
run_trigger() {
  local mode="$1"
  local rc out="$work/out.$mode"
  : > "$work/api.$mode"; : > "$work/list.$mode"
  (
    cd "$work" || exit 99
    SERVICE=backend SERVICE_ID=stub-service-id ENVIRONMENT_ID=stub-env-id \
    SHA="$SHA_STUB" RAILWAY_TOKEN=stub-token RAILWAY_PROJECT=stub-project \
    RAILWAY_ENV=staging ATTEMPTS=4 MUTATE_ATTEMPTS=3 MUTATE_BASE_DELAY_S=0 \
    VERIFY_URL=https://backend-staging-new.up.railway.app/api/v1/public/build \
    STUB_MODE="$mode" STUB_API_COUNT="$work/api.$mode" \
    STUB_LIST_COUNT="$work/list.$mode" PATH="$work/bin:$PATH" \
    bash "$script"
  ) > "$out" 2>&1
  rc=$?
  printf '%s %s %s\n' "$rc" "$(cat "$work/api.$mode")" "$(cat "$work/list.$mode")"
}

# --- 1. happy path -------------------------------------------------------------
read -r rc api n <<<"$(run_trigger ok)"
check "ok: exits 0" "0" "$rc"
check "ok: the mutation was asked exactly once" "1" "$api"
# Call 1 snapshots the pre-existing rows — that old row already carries SHA_STUB and
# SUCCESS, so a selector that matched on the commit alone would have declared the
# deploy finished before the mutation ran. Call 2 is the first poll, and the row it
# accepts must be the NEW id. The next assertion is the one that proves it.
check "ok: one snapshot plus one poll, no more" "2" "$n"
grep -q "row bbbbbbbb" "$work/out.ok" && chose=yes || chose=no
check "ok: it reports the NEW row, not the old one" "yes" "$chose"
grep -Eq 'branch main, created 2026-11-18T21:54:39\.000Z' "$work/out.ok" && named=yes || named=no
check "ok: the done-line names the branch and the row's created time" "yes" "$named"
grep -q 'jq: error' "$work/out.ok" && leaked=yes || leaked=no
check "ok: no jq compile error leaked from the done-line into the log" "no" "$leaked"
grep -q 'verified: https://backend-staging-new' "$work/out.ok" && v=yes || v=no
check "ok: SUCCESS is not enough — the served sha is compared too" "yes" "$v"

# --- 2. data=false: nothing started, so do not wait ----------------------------
read -r rc api n <<<"$(run_trigger api-false)"
[ "$rc" -ne 0 ] && nonzero=yes || nonzero=no
check "data=false: exits non-zero" "yes" "$nonzero"
check "data=false: it stopped without polling for a phantom row" "1" "$n"
grep -q 'did not return data=true' "$work/out.api-false" && named=yes || named=no
check "data=false: the error names the mutation that declined" "yes" "$named"

# --- 3. api refuses: bounded retries, then give up ----------------------------
read -r rc api n <<<"$(run_trigger api-error)"
[ "$rc" -ne 0 ] && nonzero=yes || nonzero=no
check "api error: exits non-zero" "yes" "$nonzero"
check "api error: retried to MUTATE_ATTEMPTS=3 then stopped" "3" "$api"
check "api error: never started polling" "1" "$n"

# --- 4. a new row that is not our commit must never pass ----------------------
read -r rc api n <<<"$(run_trigger bad-commit)"
[ "$rc" -ne 0 ] && nonzero=yes || nonzero=no
check "wrong commit: exits non-zero" "yes" "$nonzero"
grep -q 'does not carry' "$work/out.bad-commit" && refused=yes || refused=no
check "wrong commit: it refuses to call the row ours" "yes" "$refused"

# --- 5. terminal FAILED: report and dump the log ------------------------------
read -r rc api n <<<"$(run_trigger row-failed)"
[ "$rc" -ne 0 ] && nonzero=yes || nonzero=no
check "failed row: exits non-zero" "yes" "$nonzero"
grep -q 'ended with FAILED' "$work/out.row-failed" && stated=yes || stated=no
check "failed row: prints the terminal status" "yes" "$stated"
grep -q 'log lines for this deployment' "$work/out.row-failed" && dumped=yes || dumped=no
check "failed row: fetches the deployment log rather than guessing" "yes" "$dumped"

# --- 6. SUCCESS but the instance serves another commit -----------------------
read -r rc api n <<<"$(run_trigger wrong-build)"
[ "$rc" -ne 0 ] && nonzero=yes || nonzero=no
check "wrong build: exits non-zero" "yes" "$nonzero"
grep -q 'serves 999999999999999999999999999999999999999b' "$work/out.wrong-build" && caught=yes || caught=no
check "wrong build: names the commit actually served" "yes" "$caught"

# --- 7. fitness: the selectors read the fields the CLI really returns ---------
grep -vE '^\s*#' "$script" | grep -q 'gmtCreate' && clean=no || clean=yes
check "fitness: no filter on gmtCreate (absent from the CLI list JSON)" "yes" "$clean"
grep -q 'select(.meta.cliMessage' "$script" && clean=no || clean=yes
check "fitness: the row selector is not the upload lane's cliMessage" "yes" "$clean"
grep -vE '^\s*#' "$script" | grep -q 'latestCommit' && pinned=no || pinned=yes
check "fitness: never latestCommit (a merge train would deploy an unapproved sha)" "yes" "$pinned"

echo
if [ "$failures" -eq 0 ]; then
  echo "ok — the trigger lane waits for a new row of THIS commit and verifies what is served"
  exit 0
fi
echo "$failures assertion(s) failed"
exit 1
