#!/usr/bin/env bash
# test-staging-deploy-watch.sh — prove the staging leg deploys by mutation and
# proves it with a ROW, and prove this test can still see it fail.
#
# WHY THIS EXISTS
# Since 2026-11-16 every `deploy Staging (…)` leg of every release train has died
# on Railway's upload-initiate request (`Failed to fetch: error decoding response
# body`, 9-for-9 against the full 900 s ladder, with zero Indexing/Uploading
# lines — it refuses before the archive is packed). On 2026-11-23 the release
# lane's own write cell measured the alternative with the SAME credential CI
# holds: run 45194092365 sent `serviceInstanceDeploy(commitSha:)` under
# RAILWAY_TOKEN_STAGING, got `mutation=accepted`, and a new SUCCESS row
# `d1fb169d` appeared 30 s later with zero bytes uploaded. release.yml's staging
# legs now run that instead of `railway up`.
#
# That makes the leg's verdict depend on two claims, each independently capable
# of lying:
#   * "the mutation said true" — true with NO row is the measured behaviour of a
#     git-less service instance (production frontend-admin, reason=redeploy).
#   * "a new row exists" — satisfied by ANY new row: another session's upload, a
#     console deploy, or a row for a different commit. The API accepts a short
#     sha and mints a FAILED row for a commit that does not exist (measured
#     2026-11-23: commitSha:"d563144" -> row a0f80410 FAILED, 12:56:43Z).
# So the candidate row must NAME the reviewed commit.
#
# HOW IT WORKS
# The real railway-deploy.sh runs in mutation mode against a stub `railway`, one
# scenario per failure mode. Every scenario asserts the exit code AND what the
# leg called: the `up` counter is checked in all of them, because if a mutation
# leg ever packs an archive again the wall comes back and this test should say
# so instead of a release discovering it. The `noop`, `stale-green`,
# `other-commit`, `console-row`, `build-failed`, `refused` and `no-baseline`
# scenarios are the red controls — a suite that goes green whatever the script
# does would prove nothing, and this is exactly the suite that must be able to
# see a silent no-op and another train's row alike.
#
# Run:  bash scripts/ci/test-staging-deploy-watch.sh
# No network. Measured 98 checks in 57 s on a laptop on 2026-11-23 — 11 stubbed
# legs (4 green shapes, 7 red controls), the classifier cells including the
# STARTED_AT cutoff matrix, the argument guards and the wiring pins. `sleep` is
# stubbed so none of it waits on a clock.
# It shares the secret-hygiene runner with the other deploy tests rather than
# getting a lane of its own.
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
deploy="$repo_root/scripts/ci/railway-deploy.sh"
probe="$repo_root/scripts/ci/f2-token-probe.sh"
watch_py="$repo_root/scripts/ci/staging-deploy-watch.py"
release_yml="$repo_root/.github/workflows/release.yml"

command -v jq >/dev/null || { echo "FAIL: jq is required"; exit 1; }
for f in "$deploy" "$watch_py" "$probe"; do
  [ -f "$f" ] || { echo "FAIL: $f missing"; exit 1; }
done

SHA_STUB="1111111111111111111111111111111111111111"
OTHER_SHA="2222222222222222222222222222222222222222"
BASE_ID="00000000-0000-0000-0000-00000000000b"
NEW_ID="00000000-0000-0000-0000-00000000000n"
# A row that already existed when this leg fired — the shape a second train on
# the same commit leaves behind.
STALE_ID="00000000-0000-0000-0000-00000000000s"
STAGING_ENV_ID="6b5f27a3-a290-4574-a977-363eb21d43ad"
BACKEND_ID="70de07d8-c058-4221-b645-61c4f1ac7aa5"
# Real ids on this project that must never appear on a staging leg. Re-read
# 2026-11-23: the project has an environment literally named `staging-Old`, so
# "is it the staging one" is a question with two plausible-looking answers.
PROD_ENV_ID="f84c4558-8cbf-43e5-8e1b-f19ee3677133"
OLD_STAGING_ENV_ID="acf4b4fe-d3bf-4498-87d2-7a7623c2ab34"
export SHA_STUB OTHER_SHA BASE_ID NEW_ID STALE_ID STAGING_ENV_ID BACKEND_ID

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/tree/fake"

cat > "$work/bin/railway" <<'STUB'
#!/usr/bin/env bash
# Enough of the railway CLI for railway-deploy.sh's mutation mode: `api` (the
# mutation), `deployment list` (the baseline read and the watch), `logs` (the
# crash dump) and `up`, which records that it happened and fails loudly.
cmd="${1:-}"; shift || true
case "$cmd" in
  up)
    printf 'railway up %s\n' "$*" >> "$STUB_UP_LOG"
    echo "STUB: a mutation leg must not run 'railway up'" >&2
    exit 77
    ;;
  api)
    printf 'api %s\n' "$*" >> "$STUB_API_LOG"
    n=0; [ -f "$STUB_API_COUNT" ] && n="$(cat "$STUB_API_COUNT")"
    n=$((n + 1)); printf '%s' "$n" > "$STUB_API_COUNT"
    case "${STUB_MODE}" in
      refused)
        # Measured shape of a refusal on this API: HTTP 200 carrying errors[].
        printf '%s\n' '{"errors":[{"extensions":{"code":"INTERNAL_SERVER_ERROR"},"message":"Not Authorized"}]}'
        echo "Railway API request completed" >&2
        exit 0
        ;;
      *)
        printf '%s\n' '{"data":{"serviceInstanceDeploy":true}}'
        echo "Railway API request completed" >&2
        exit 0
        ;;
    esac
    ;;
  deployment)
    sub="${1:-}"; shift || true
    [ "$sub" = list ] || { echo "STUB: unexpected deployment subcommand: $sub" >&2; exit 1; }
    limit=10
    while [ $# -gt 0 ]; do
      if [ "$1" = --limit ]; then limit="${2:-10}"; shift 2; continue; fi
      shift
    done
    base="$(printf '{"id":"%s","status":"SUCCESS","meta":{"commitHash":"%s"}}' "$BASE_ID" "$OTHER_SHA")"
    row() { printf '{"id":"%s","status":"%s","meta":%s}' "$NEW_ID" "$1" "$2"; }
    if [ "$limit" = 1 ]; then
      # The pre-mutation baseline read. `no-baseline` answers with a page that
      # names no row at all, which the leg must refuse instead of treating
      # every later row as "new".
      if [ "${STUB_MODE}" = no-baseline ]; then printf '[]'; else printf '[%s]' "$base"; fi
      printf 'list1\n' >> "$STUB_LIST_LOG"
      exit 0
    fi
    n=0; [ -f "$STUB_POLL_COUNT" ] && n="$(cat "$STUB_POLL_COUNT")"
    n=$((n + 1)); printf '%s' "$n" > "$STUB_POLL_COUNT"
    printf 'list10\n' >> "$STUB_LIST_LOG"
    case "${STUB_MODE}" in
      noop)          printf '[%s]' "$base" ;;
      no-baseline)   printf '[%s]' "$base" ;;
      other-commit)  printf '[%s,%s]' "$(row SUCCESS "{\"commitHash\":\"$OTHER_SHA\"}")" "$base" ;;
      build-failed)  printf '[%s,%s]' "$(row FAILED "{\"commitHash\":\"$SHA_STUB\"}")" "$base" ;;
      console-row)   printf '[%s,%s]' "$(row SUCCESS 'null')" "$base" ;;
      pending-first)
        if [ "$n" -le 1 ]; then
          printf '[%s,%s]' "$(row BUILDING "{\"commitHash\":\"$SHA_STUB\"}")" "$base"
        else
          printf '[%s,%s]' "$(row SUCCESS "{\"commitHash\":\"$SHA_STUB\"}")" "$base"
        fi ;;
      # green-string-meta: meta as a JSON STRING, the shape a flattened `meta`
      # selection returns. A parser that assumes a dict reads it as "no commit".
      green-string-meta)
        printf '[%s,%s]' "$(row SUCCESS "\"{\\\"commitHash\\\":\\\"$SHA_STUB\\\"}\"")" "$base" ;;
      # upload-spelling: the commit in meta.cliMessage, where an upload puts it.
      # Both spellings must read as this leg's deploy.
      upload-spelling)
        printf '[%s,%s]' "$(row SUCCESS "{\"cliMessage\":\"$SHA_STUB\"}")" "$base" ;;
      # stale-green: a SUCCESS row naming THIS commit, created long before this
      # leg fired its mutation. That is what a second train on the same sha
      # leaves behind (release.yml has no workflow-level concurrency, and a
      # Release re-run does it to one commit). Crediting it is the false green
      # the STARTED_AT cutoff exists to stop.
      stale-green)
        printf '[%s,%s]' \
          "{\"id\":\"$STALE_ID\",\"status\":\"SUCCESS\",\"createdAt\":\"2020-01-01T00:00:00.000Z\",\"meta\":{\"commitHash\":\"$SHA_STUB\"}}" \
          "$base" ;;
      *)             printf '[%s,%s]' "$(row SUCCESS "{\"commitHash\":\"$SHA_STUB\"}")" "$base" ;;
    esac
    exit 0
    ;;
  logs)
    echo "stub deploy logs: panic: runtime error: invalid memory address"
    exit 0
    ;;
  *)
    echo "stub railway: unexpected invocation: $cmd $*" >&2
    exit 1
    ;;
esac
STUB
chmod +x "$work/bin/railway"

# A no-op `sleep`: the leg polls 15 s apart by design, and a gate that waits for
# real minutes is a gate people delete.
printf '#!/usr/bin/env bash\nexit 0\n' > "$work/bin/sleep"
chmod +x "$work/bin/sleep"

failures=0
checks=0
count() { # <file> <pattern> -> number of matching lines, 0 for an empty file
  local n
  n="$(grep -c "$2" "$1" 2>/dev/null)" || true
  printf '%s' "${n:-0}"
}
num() { # <file> -> its content, or 0 when the file was never written to
  local v
  v="$(cat "$1" 2>/dev/null)" || true
  printf '%s' "${v:-0}"
}
check() { # <label> <expected> <actual>
  checks=$((checks + 1))
  if [ "$2" = "$3" ]; then
    echo "PASS  $1"
  else
    echo "FAIL  $1 (expected [$2], got [$3])"
    failures=$((failures + 1))
  fi
}

# run_leg <stub-mode> -> "<rc> <up-calls> <api-calls> <poll-calls>"
run_leg() {
  local mode="$1" rc
  : > "$work/up.$mode"; : > "$work/api.$mode"; : > "$work/list.$mode"
  : > "$work/api_count.$mode"; : > "$work/poll_count.$mode"
  (
    cd "$work/tree" || exit 99
    STUB_MODE="$mode" \
      STUB_UP_LOG="$work/up.$mode" STUB_API_LOG="$work/api.$mode" \
      STUB_LIST_LOG="$work/list.$mode" STUB_API_COUNT="$work/api_count.$mode" \
      STUB_POLL_COUNT="$work/poll_count.$mode" \
      PATH="$work/bin:$PATH" \
      SERVICE=backend RAILWAY_ENV=staging SHA="$SHA_STUB" \
      RAILWAY_TOKEN=rlwy_stub_value_never_printed \
      RAILWAY_PROJECT=00000000-0000-0000-0000-000000000000 \
      DEPLOY_METHOD=mutation SERVICE_ID="$BACKEND_ID" \
      RAILWAY_ENVIRONMENT_ID="$STAGING_ENV_ID" \
      ATTEMPTS=4 MUT_RETRY_ATTEMPTS=1 MUT_RETRY_BASE_DELAY_S=0 \
      bash "$deploy" >"$work/out.$mode" 2>&1
  )
  rc=$?
  printf '%s %s %s %s' "$rc" \
    "$(count "$work/up.$mode" '^railway up')" \
    "$(num "$work/api_count.$mode")" \
    "$(count "$work/list.$mode" '^list10$')"
}

echo "=== the leg, green: the two shapes a real deploy row arrives in"
out="$(run_leg green)"; set -- $out
check "green: exits 0"                    "0" "$1"
check "green: never ran railway up"       "0" "$2"
check "green: sent exactly one mutation"  "1" "$3"
check "green: decided on the first poll"  "1" "$4"
check "green: names the deploy in the log" "yes" \
  "$(grep -q 'deployed 1111111111.* (mutation)' "$work/out.green" && echo yes || echo no)"
check "green: the mutation carried the staging service id" "1" \
  "$(count "$work/api.green" "s=$BACKEND_ID")"
check "green: the mutation carried the staging environment id" "yes" \
  "$(grep -q "e=$STAGING_ENV_ID" "$work/api.green" && echo yes || echo no)"
check "green: the mutation carried the full sha" "yes" \
  "$(grep -q "sha=$SHA_STUB" "$work/api.green" && echo yes || echo no)"
check "green: the mutation document pins commitSha" "yes" \
  "$(grep -q 'commitSha:' "$work/api.green" && echo yes || echo no)"
# Redaction, checked rather than asserted: the leg must not put the bearer value
# in the arguments it logs (or anywhere else in the job log).
check "green: the token appears in no recorded argv" "0" \
  "$(count "$work/api.green" 'rlwy_stub_value_never_printed')"
check "green: the token appears nowhere in the leg log" "0" \
  "$(count "$work/out.green" 'rlwy_stub_value_never_printed')"

out="$(run_leg green-string-meta)"; set -- $out
check "green via a stringified meta: exits 0" "0" "$1"
out="$(run_leg upload-spelling)"; set -- $out
check "commit read from meta.cliMessage: exits 0" "0" "$1"
out="$(run_leg pending-first)"; set -- $out
check "pending-then-success: exits 0" "0" "$1"
check "pending-then-success: a BUILDING row is not a verdict (polled twice)" "2" "$4"

echo "=== the red controls: every way this leg could go green without deploying"
out="$(run_leg noop)"; set -- $out
check "noop: 'true' and no new row is RED, not green" "1" "$1"
check "noop: never ran railway up"                    "0" "$2"
check "noop: the leg names the no-op, not a bare timeout" "yes" \
  "$(grep -q 'mutation-is-noop' "$work/out.noop" && echo yes || echo no)"

# The same commit already deployed by someone else, before this leg fired: the
# row is real, it names the sha, and it is not ours. Without the STARTED_AT
# cutoff this scenario exits 0, which is the false green this whole guard
# exists to refuse — hence it sits with the red controls, not the green ones.
out="$(run_leg stale-green)"; set -- $out
check "stale-green: a row predating the mutation is NOT our deploy" "1" "$1"
check "stale-green: never ran railway up"                           "0" "$2"
check "stale-green: reported as the no-op it was, not a bare timeout" "yes" \
  "$(grep -q 'mutation-is-noop' "$work/out.stale-green" && echo yes || echo no)"
check "stale-green: the log still shows the row it dismissed" "yes" \
  "$(grep -q "$STALE_ID" "$work/out.stale-green" && echo yes || echo no)"

out="$(run_leg other-commit)"; set -- $out
check "a new row naming ANOTHER commit is RED" "1" "$1"
check "other-commit: verdict names the mismatch" "yes" \
  "$(grep -q 'row-naming-another-commit' "$work/out.other-commit" && echo yes || echo no)"

out="$(run_leg console-row)"; set -- $out
check "a new row with no commit recorded is RED" "1" "$1"

out="$(run_leg build-failed)"; set -- $out
check "a FAILED row naming this commit is RED" "1" "$1"
check "build-failed: dumps the deployment log" "yes" \
  "$(grep -q 'panic: runtime error' "$work/out.build-failed" && echo yes || echo no)"
check "build-failed: still never ran railway up" "0" "$2"

out="$(run_leg refused)"; set -- $out
check "a refused mutation is RED" "1" "$1"
check "a refused mutation tried the mutation once" "1" "$3"
check "a refused mutation polls ZERO times (fails at once, not after 10 min)" "0" "$4"
check "the HTTP-200 errors[] body reads as a token refusal" "yes" \
  "$(grep -q 'token-rejected' "$work/out.refused" && echo yes || echo no)"

out="$(run_leg no-baseline)"; set -- $out
check "an unreadable baseline is RED" "1" "$1"
check "an unreadable baseline sends NO mutation (it refuses to guess at 'new row')" "0" "$3"

echo "=== the guards: a leg that cannot be aimed says so before asking Railway"
guards="$(
  cd "$work/tree" || exit 99
  PATH="$work/bin:$PATH" SERVICE=backend RAILWAY_ENV=staging SHA="$SHA_STUB" \
    RAILWAY_TOKEN=t RAILWAY_PROJECT=p DEPLOY_METHOD=mutation \
    RAILWAY_ENVIRONMENT_ID="$STAGING_ENV_ID" \
    bash "$deploy" 2>&1; printf 'rc=%s' "$?"
)"
check "missing SERVICE_ID refuses at once" "rc=2" "$(printf '%s' "$guards" | tail -1)"
check "missing SERVICE_ID: the refusal is named" "yes" \
  "$(printf '%s' "$guards" | grep -q 'needs SERVICE_ID' && echo yes || echo no)"

short="$(
  cd "$work/tree" || exit 99
  PATH="$work/bin:$PATH" SERVICE=backend RAILWAY_ENV=staging SHA=d563144 \
    RAILWAY_TOKEN=t RAILWAY_PROJECT=p DEPLOY_METHOD=mutation \
    SERVICE_ID="$BACKEND_ID" RAILWAY_ENVIRONMENT_ID="$STAGING_ENV_ID" \
    bash "$deploy" 2>&1; printf 'rc=%s' "$?"
)"
check "a short SHA refuses (it mints a FAILED row for a commit that does not exist)" "rc=2" \
  "$(printf '%s' "$short" | tail -1)"

badenv="$(
  cd "$work/tree" || exit 99
  PATH="$work/bin:$PATH" SERVICE=backend RAILWAY_ENV=staging SHA="$SHA_STUB" \
    RAILWAY_TOKEN=t RAILWAY_PROJECT=p DEPLOY_METHOD=mutation \
    SERVICE_ID="$BACKEND_ID" \
    bash "$deploy" 2>&1; printf 'rc=%s' "$?"
)"
check "missing RAILWAY_ENVIRONMENT_ID refuses" "rc=2" "$(printf '%s' "$badenv" | tail -1)"

badmethod="$(
  cd "$work/tree" || exit 99
  PATH="$work/bin:$PATH" SERVICE=backend RAILWAY_ENV=staging SHA="$SHA_STUB" \
    RAILWAY_TOKEN=t RAILWAY_PROJECT=p DEPLOY_METHOD=teleport \
    bash "$deploy" 2>&1; printf 'rc=%s' "$?"
)"
check "an unknown DEPLOY_METHOD refuses" "rc=2" "$(printf '%s' "$badmethod" | tail -1)"

echo "=== the classifier, through the same argv cells the leg uses"
cell() { python3 "$watch_py" "$@"; }
# Fixtures are built as variables, one JSON page per shape. Not for tidiness:
# `\"` inside a `$( ... )` that is itself inside double quotes is a quoting
# layer nobody should be reasoning about while reading a failure, and a fixture
# that arrives at python mangled reads as `rows-unparseable` — the wrong verdict
# for the wrong reason.
row_json() { printf '{"id":"%s","status":"%s","meta":%s}' "$1" "$2" "$3"; }
BASE_ROW="$(row_json "$BASE_ID" SUCCESS "{\"commitHash\":\"$OTHER_SHA\"}")"
NEW_OK="$(row_json "$NEW_ID" SUCCESS "{\"commitHash\":\"$SHA_STUB\"}")"
R_OTHER="$(row_json "r-other" SUCCESS "{\"commitHash\":\"$OTHER_SHA\"}")"
R_IS_BASE="$(row_json "$BASE_ID" SUCCESS "{\"commitHash\":\"$SHA_STUB\"}")"
R_SHORT="$(row_json "r-short" SUCCESS "{\"commitHash\":\"${SHA_STUB:0:7}\"}")"
R_NULL_META="$(row_json "r-null" SUCCESS 'null')"
R_CRASHED="$(row_json "r-crash" CRASHED "{\"commitHash\":\"$SHA_STUB\"}")"
R_REMOVED="$(row_json "r-removed" REMOVED "{\"commitHash\":\"$SHA_STUB\"}")"
check "watch: new SUCCESS naming the sha"            "deployed"       "$(cell watch "[$NEW_OK,$BASE_ROW]" "$BASE_ID" "$SHA_STUB")"
check "watch: only the baseline is visible"          "no-new-row"     "$(cell watch "[$BASE_ROW]" "$BASE_ID" "$SHA_STUB")"
check "watch: a row naming another commit"           "other-commit"   "$(cell watch "[$R_OTHER]" "$BASE_ID" "$SHA_STUB")"
check "watch: a row that IS the baseline is excluded" "no-new-row"    "$(cell watch "[$R_IS_BASE]" "$BASE_ID" "$SHA_STUB")"
check "watch: a null baseline id still needs a matching commit" "deployed" "$(cell watch "[$NEW_OK]" "" "$SHA_STUB")"
check "watch: not JSON is not 'no new row'"          "rows-unparseable" "$(cell watch "not json" "$BASE_ID" "$SHA_STUB")"
check "watch: a JSON object is not a page"           "rows-unparseable" "$(cell watch "{\"id\":\"x\"}" "$BASE_ID" "$SHA_STUB")"
check "watch: an empty page"                         "no-new-row"     "$(cell watch "[]" "$BASE_ID" "$SHA_STUB")"
check "watch: a 7-char stored hash matches"          "deployed"       "$(cell watch "[$R_SHORT]" "$BASE_ID" "$SHA_STUB")"
check "watch: null meta is never a match"            "other-commit"   "$(cell watch "[$R_NULL_META]" "$BASE_ID" "$SHA_STUB")"
check "watch: a CRASHED row naming the sha is terminal-bad" "build-failed" "$(cell watch "[$R_CRASHED]" "$BASE_ID" "$SHA_STUB")"
check "watch: a REMOVED row naming the sha is terminal-bad" "build-failed" "$(cell watch "[$R_REMOVED]" "$BASE_ID" "$SHA_STUB")"

# ---- the cutoff. Same pages, one extra argument: the instant the leg fired.
# Nothing above names a createdAt, which is the point of the first of these: an
# absent or unrecognised time must NOT filter, or a platform that changes its
# timestamp spelling silently turns every green leg red.
rowd() { printf '{"id":"%s","status":"%s","createdAt":"%s","meta":%s}' "$1" "$2" "$3" "$4"; }
CUTOFF="2026-11-23T14:00:00Z"
STALE_OK="$(rowd "$STALE_ID" SUCCESS "2026-11-23T13:59:59.900Z" "{\"commitHash\":\"$SHA_STUB\"}")"
STALE_BAD="$(rowd "$STALE_ID" REMOVED "2026-11-23T13:59:59.900Z" "{\"commitHash\":\"$SHA_STUB\"}")"
SAME_SEC="$(rowd "$NEW_ID" SUCCESS "2026-11-23T14:00:00.500Z" "{\"commitHash\":\"$SHA_STUB\"}")"
FRESH_OK="$(rowd "$NEW_ID" SUCCESS "2026-11-23T14:03:12.000Z" "{\"commitHash\":\"$SHA_STUB\"}")"
NO_TIME_OK="$(printf '{"id":"%s","status":"SUCCESS","createdAt":"sometime","meta":{"commitHash":"%s"}}' "$NEW_ID" "$SHA_STUB")"
check "watch: a SUCCESS row predating the cutoff is scenery, not our deploy" \
  "no-new-row" "$(cell watch "[$STALE_OK]" "$BASE_ID" "$SHA_STUB" "$CUTOFF")"
check "watch: without a cutoff the same page is credited (old behaviour intact)" \
  "deployed" "$(cell watch "[$STALE_OK]" "$BASE_ID" "$SHA_STUB")"
check "watch: a REMOVED row predating the cutoff is not this leg's build failure" \
  "no-new-row" "$(cell watch "[$STALE_BAD]" "$BASE_ID" "$SHA_STUB" "$CUTOFF")"
check "watch: a row created after the cutoff counts" \
  "deployed" "$(cell watch "[$FRESH_OK]" "$BASE_ID" "$SHA_STUB" "$CUTOFF")"
check "watch: a row in the cutoff's own second counts (ms truncated, not compared)" \
  "deployed" "$(cell watch "[$SAME_SEC]" "$BASE_ID" "$SHA_STUB" "$CUTOFF")"
check "watch: an unrecognised row time never filters a real deploy out" \
  "deployed" "$(cell watch "[$NO_TIME_OK]" "$BASE_ID" "$SHA_STUB" "$CUTOFF")"
check "watch: the baseline is excluded by id even when it is newer than the cutoff" \
  "no-new-row" "$(cell watch "[$(rowd "$BASE_ID" SUCCESS "2026-11-23T14:05:00.000Z" "{\"commitHash\":\"$SHA_STUB\"}")]" "$BASE_ID" "$SHA_STUB" "$CUTOFF")"
check "watch: a scenery-only page is a no-op, not another train's commit" \
  "no-new-row" "$(cell watch "[$STALE_OK,$BASE_ROW]" "$BASE_ID" "$SHA_STUB" "$CUTOFF")"
check "stale: a row a second before the cutoff is stale" "stale" \
  "$(cell stale "{\"createdAt\":\"2026-11-23T13:59:59.900Z\"}" "2026-11-23T14:00:00Z")"
check "stale: the cutoff's own second belongs to this attempt, not to the previous train" "new" \
  "$(cell stale "{\"createdAt\":\"2026-11-23T14:00:00.500Z\"}" "2026-11-23T14:00:00Z")"
check "stale: a later row is new" "new" \
  "$(cell stale "{\"createdAt\":\"2026-11-23T14:00:01.000Z\"}" "2026-11-23T14:00:00Z")"
check "stale: no createdAt is never stale" "new" \
  "$(cell stale "{\"id\":\"x\"}" "2026-11-23T14:00:00Z")"
check "stale: no cutoff means nothing is stale" "new" \
  "$(cell stale "{\"createdAt\":\"2020-01-01T00:00:00.000Z\"}" "")"
check "describe: reports the row under watch, tab-separated" \
  "$(printf '%s\t%s\t%s\t%s' "$NEW_ID" SUCCESS "$SHA_STUB" mine)" \
  "$(cell describe "[$NEW_OK,$BASE_ROW]" "$BASE_ID" "$SHA_STUB")"
check "describe: an empty page says so instead of inventing a row" \
  "-	-	-	other" "$(cell describe "[]" "$BASE_ID" "$SHA_STUB")"
# A leg that goes red on the cutoff must print the row it refused to trust, or
# the next person re-runs the train instead of reading the race.
check "describe: shows the stale row the cutoff dismissed, marked as not ours" \
  "$(printf '%s\t%s\t%s\t%s' "$STALE_ID" SUCCESS "$SHA_STUB" other)" \
  "$(cell describe "[$STALE_OK,$BASE_ROW]" "$BASE_ID" "$SHA_STUB" "$CUTOFF")"

check "final: accepted + deployed"                   "deployed"    "$(cell final accepted deployed)"
check "final: accepted + no row"                     "mutation-is-noop" "$(cell final accepted no-new-row)"
check "final: refused + deployed stays refused"      "mutation-refused (token-rejected)" "$(cell final token-rejected deployed)"
check "final: accepted + unparseable page is blind, not green" "watch-blind" "$(cell final accepted rows-unparseable)"
check "final: accepted + still building"             "timeout-pending (pending)" "$(cell final accepted pending)"

echo "=== the wiring"
# The mutation document must be the one the write cell actually measured, byte
# for byte — a drifted document here is the cell going red for a shape reason.
probe_doc="$(grep '^DOC_DEPLOY_SHA=' "$probe")"
deploy_doc="$(grep '^DOC_DEPLOY_SHA=' "$deploy")"
check "railway-deploy.sh sends the probe's mutation document verbatim" "$probe_doc" "$deploy_doc"
check "the document is never the latestCommit spelling" "0" \
  "$(grep -c 'latestCommit:' "$deploy")"
# The mutation branch, read off the script's own structure: it must contain no
# upload call. `railway up` also appears in this file's PROSE (the fault
# description), so grepping the whole script would count comments — and the
# behavioural proof is already the stub, which exits 77 and records any `up`
# call in every scenario above.
mutate_branch="$(awk '/^if \[ "\$DEPLOY_METHOD" = mutation \]; then$/{f=1}
  f && /^elif \[ -n "\$ARCHIVE_TMP" \]; then$/ {exit} f' "$deploy")"
check "the mutation branch exists to be read (structure drift goes loud)" "yes" \
  "$([ -n "$mutate_branch" ] && echo yes || echo no)"
check "the mutation branch contains no 'railway up'" "0" \
  "$(printf '%s' "$mutate_branch" | grep -c 'railway up')"
# ... and no call of upload(), which is how a leg would reach `railway up`
# WITHOUT the string appearing in the branch. Mutant 3 on 2026-11-23 proved the
# difference: an inserted `upload || true` was caught by the stub's up-counter
# (9 calls) while the text-only check stayed green.
check "the mutation branch neither uploads nor calls upload()" "0" \
  "$(printf '%s' "$mutate_branch" | grep -c 'upload')"
check "default stays upload (dev and production legs are untouched)" "1" \
  "$(grep -c 'DEPLOY_METHOD:-upload' "$deploy")"
check "the upload path still identifies its row by meta.cliMessage" "1" \
  "$(grep -c 'meta.cliMessage == \$m' "$deploy")"
# Counted on the CALL form, not the filename: the file's prose names the module
# too, and a comment edit is not a change to what the leg executes.
check "the leg executes the classifier three times (watch + describe + final)" "3" \
  "$(grep -c 'SCRIPT_DIR/staging-deploy-watch.py' "$deploy")"
# The cutoff is only a guard if it is taken INSIDE the window it guards: after
# the baseline read (so a row that predates the leg can never be the baseline
# AND predates the cutoff — one of the two must catch it) and before the
# mutation (so a row the mutation minted in the same second is never dismissed).
baseline_pos="$(printf '%s' "$mutate_branch" | grep -n 'BASELINE_ROW="$(baseline_row_id)"' | cut -d: -f1)"
cutoff_pos="$(printf '%s' "$mutate_branch" | grep -n 'STARTED_AT="$(date -u' | cut -d: -f1)"
fire_pos="$(printf '%s' "$mutate_branch" | grep -n 'mutate_deploy 2>&1' | cut -d: -f1)"
check "the cutoff is taken after the baseline read" "yes" \
  "$([ -n "$baseline_pos" ] && [ -n "$cutoff_pos" ] && [ "$cutoff_pos" -gt "$baseline_pos" ] && echo yes || echo no)"
check "the cutoff is taken before the mutation fires" "yes" \
  "$([ -n "$cutoff_pos" ] && [ -n "$fire_pos" ] && [ "$cutoff_pos" -lt "$fire_pos" ] && echo yes || echo no)"
check "both classifier reads of the page carry the cutoff" "2" \
  "$(grep -c 'STARTED_AT:-}' "$deploy")"
check "the cutoff is UTC, because createdAt is UTC and the compare is textual" "1" \
  "$(grep -c 'date -u +%Y-%m-%dT%H:%M:%SZ' "$deploy")"
check "the token is never echoed" "0" \
  "$(grep -cE '^[[:space:]]*echo [^#]*\$\{?RAILWAY_TOKEN' "$deploy")"

job_block() { # <anchored job key>
  awk -v k="$1" '$0 ~ k {f=1; next} f && /^  [a-zA-Z0-9_-]+:[ ]*$/ {f=0} f' "$release_yml"
}
staging_job="$(job_block '^  deploy-staging:')"
check "release.yml staging leg calls the deploy script" "1" \
  "$(printf '%s' "$staging_job" | grep -c 'bash scripts/ci/railway-deploy.sh')"
check "release.yml staging leg sets DEPLOY_METHOD: mutation" "1" \
  "$(printf '%s' "$staging_job" | grep -c 'DEPLOY_METHOD: mutation')"
check "release.yml staging leg carries the staging environment id" "1" \
  "$(printf '%s' "$staging_job" | grep -c -- "$STAGING_ENV_ID")"
check "release.yml staging leg is NOT aimed at the production environment" "0" \
  "$(printf '%s' "$staging_job" | grep -c -- "$PROD_ENV_ID")"
check "release.yml staging leg is NOT aimed at 'staging-Old'" "0" \
  "$(printf '%s' "$staging_job" | grep -c -- "$OLD_STAGING_ENV_ID")"
check "release.yml staging matrix names three service ids" "3" \
  "$(printf '%s' "$staging_job" | grep -cE 'service_id: [0-9a-f-]{36}')"
check "release.yml staging leg ships no upload shape" "0" \
  "$(printf '%s' "$staging_job" | grep -cE 'upload_path|archive_subdir|root_flag|build_dir')"
check "release.yml staging leg keeps the staging secret on its env line" "1" \
  "$(printf '%s' "$staging_job" | grep -c -- 'RAILWAY_TOKEN: \${{ secrets.RAILWAY_TOKEN_STAGING }}')"
# Dev and production must still upload: this change is staging-only, and a leg
# that silently became a mutation would deploy a commit Railway's connection
# picks rather than the tree the runner checked out.
check "deploy-development sets no DEPLOY_METHOD" "0" \
  "$(job_block '^  deploy-development:' | grep -c 'DEPLOY_METHOD')"
check "deploy-production sets no DEPLOY_METHOD" "0" \
  "$(job_block '^  deploy-production' | grep -c 'DEPLOY_METHOD')"
check "deploy-development still uploads" "yes" \
  "$(job_block '^  deploy-development:' | grep -q 'railway up\|UPLOAD_PATH' && echo yes || echo no)"
check "deploy-production still uploads" "yes" \
  "$(job_block '^  deploy-production' | grep -q 'UPLOAD_PATH' && echo yes || echo no)"

# This test has to be wired, or it is documentation.
check "ci.yml runs this test in a gate lane" "yes" \
  "$(grep -rq 'test-staging-deploy-watch.sh' "$repo_root/.github/workflows/" && echo yes || echo no)"

if [ "$failures" -ne 0 ]; then
  echo "FAIL  $failures of $checks check(s) failed"
  exit 1
fi
echo "ok — staging mutation leg pinned ($checks checks: 4 green legs, 7 red controls, the cutoff matrix, guards and wiring)"
