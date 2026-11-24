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
# `other-commit`, `console-row`, `build-failed`, `refused`, `no-baseline` and
# `rows-refused` scenarios are the red controls — a suite that goes green
# whatever the script does would prove nothing, and this is exactly the suite
# that must be able to see a silent no-op and another train's row alike.
#
# Several of the scenarios are about the READERS rather than the rows, because
# every red this leg has had since the swap has been a reader problem, not a
# Railway problem (train 45234100845, 2026-11-23T18:33:15Z: 1.1 s from the leg's
# header to `exit code 1` with nothing in between). `list-refused` makes the
# name-resolved `railway deployment list` refuse and requires the leg to deploy
# anyway — a mutation leg is aimed by ids, so it must READ by ids — and `green`
# pins that the CLI is never asked to resolve a service or environment name at
# all. `rows-refused` takes the leg's own reader away and requires the leg to
# say so out loud: a failed read plus the "could not read the pre-mutation row"
# guard, not a bare exit.
#
# The reader that `rows-refused` pins is the third one this leg has had, and the
# second refusal measured live. Fix #1 (PR #1160) read rows with the
# name-resolved CLI call and died silently; fix #2 (PR #1164) sent
# `deployments(input:)` through `railway api` and train 45302515868 was refused
# by the edge — loudly, as this suite demands — with HTTP 503 "unconditional drop
# overload" on all three staging legs at 01:51Z. Four minutes later, run
# 45308408960 sent `serviceInstance(serviceId, environmentId){ latestDeployment
# {…} }` through the SAME pinned CLI, from the SAME runner class, with the SAME
# RAILWAY_TOKEN_STAGING, and got row 2df11e51 back SUCCESS. So the rule the suite
# now enforces is stronger than "read by id": a leg must read through the
# document its credential is MEASURED against, and the only measured readable is
# f2-token-probe.sh's DOC_ROW. The leg sends that text verbatim, pinned
# byte-for-byte in the wiring section below, which is also why one document
# serves both the baseline and the watch: a second row document would be a
# second unmeasured claim.
#
# That document returns one row — the newest — instead of a page of ten. The
# suite therefore models the environment by WHEN the leg asks: before this leg's
# mutation the newest row is the pre-existing one, after it the newest row is
# whatever the scenario says the mutation produced. The stub reads that off the
# leg's own mutation call, so a leg that read its baseline AFTER mutating (or
# that re-read it between polls) would see its own deploy as the baseline and go
# red — which is the honest direction for a test to fail in.
#
# Run:  bash scripts/ci/test-staging-deploy-watch.sh
# No network. Measured 143 checks in 11 s on a laptop on 2026-11-24, three runs
# (10, 11, 11 s) — 15 stubbed legs: 6 green shapes, 9 red controls — plus the
# classifier cells including the STARTED_AT cutoff matrix, the argument guards
# and the wiring pins. `sleep` is stubbed so none of it waits on a clock. (The
# 112 s this header quoted for 115 checks was never re-measured; the figure here
# is from the three runs above.)
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
# mutation AND the row read — one document each, both aimed by ids),
# `deployment list` (the name-resolved row page, which is what upload mode uses
# and what a staging leg must NOT depend on any more), `logs` (the crash dump)
# and `up`, which records that it happened and fails loudly.
#
# Every row scenario is stated once, in `rows_page`, and each reader projects it
# into the shape ITS transport would answer with: a bare JSON array for
# `deployment list`, a `deployments` connection envelope for the list query, and
# a single `serviceInstance.latestDeployment` object for the service-instance
# query. A scenario is therefore a statement about the ROWS and not about the
# transport: switching the leg from one reader to another must not change a
# verdict, and if it does, the difference is visible here rather than in a
# release.
cmd="${1:-}"; shift || true

base="$(printf '{"id":"%s","status":"SUCCESS","meta":{"commitHash":"%s"}}' "$BASE_ID" "$OTHER_SHA")"
row() { printf '{"id":"%s","status":"%s","meta":%s}' "$NEW_ID" "$1" "$2"; }

# rows_page <lookup|baseline>: the page content for one call. `n` is the shared
# watch-lookup counter, so pending-first alternates whichever reader asks.
rows_page() {
  local kind="$1" n=0
  if [ "$kind" = baseline ]; then
    # The pre-mutation baseline read. `no-baseline` answers with a page that
    # names no row at all, which the leg must refuse instead of treating
    # every later row as "new".
    if [ "${STUB_MODE}" = no-baseline ]; then printf '[]'; else printf '[%s]' "$base"; fi
    return 0
  fi
  [ -f "$STUB_POLL_COUNT" ] && n="$(cat "$STUB_POLL_COUNT")"
  n=$((n + 1)); printf '%s' "$n" > "$STUB_POLL_COUNT"
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
}

# edges_from <array-json>: wrap rows in the GraphQL connection shape — what
# `deployments(input:)` answers with.
edges_from() {
  printf '%s' "$1" | jq -c '{data:{deployments:{edges:(map({node:.}))}}}'
}
# latest_from <array-json>: the SAME rows in the shape
# `serviceInstance{ latestDeployment{…} }` answers with — one object: the newest
# row, or null when there is no row. This projection is the point of the new
# transport, so every scenario has to survive it: `.[0]` is the newest, because
# the rows above are built newest-first.
latest_from() {
  printf '%s' "$1" | jq -c '{data:{serviceInstance:{latestDeployment:(.[0] // null)}}}'
}
case "$cmd" in
  up)
    printf 'railway up %s\n' "$*" >> "$STUB_UP_LOG"
    echo "STUB: a mutation leg must not run 'railway up'" >&2
    exit 77
    ;;
  api)
    # One endpoint, three documents, told apart by their text — the only thing
    # that distinguishes them. Keep the mutation's counters exactly as they were
    # so every pre-existing assertion still means what it said.
    doc="${1:-}"
    case "$doc" in
      *deployments\(input:*)
        # The transport PR #1164 shipped, which train 45302515868 was refused on
        # with HTTP 503 "unconditional drop overload" on all three staging legs.
        # It stays answering in the stub, but it marks the log: a leg that goes
        # back to it keeps producing verdicts, and the `connection-doc` counter
        # below is what says so out loud instead of a scenario breaking for a
        # shape reason.
        printf 'connection-doc\n' >> "$STUB_ROWS_LOG"
        printf 'api-rows %s\n' "$*" >> "$STUB_ROWS_LOG"
        # `n=1` is the baseline read; anything bigger is the watch looking again.
        first=10
        for a in "$@"; do
          case "$a" in n=*) first="${a#n=}" ;; esac
        done
        if [ "$first" = 1 ]; then
          printf 'rows1\n' >> "$STUB_ROWS_LOG"
          if [ "${STUB_MODE}" = rows-refused ]; then
            echo "Error: Not Authorized (token scope)" >&2
            exit 1
          fi
          edges_from "$(rows_page baseline)"
          echo "Railway API request completed" >&2
          exit 0
        fi
        printf 'rows10\n' >> "$STUB_ROWS_LOG"
        if [ "${STUB_MODE}" = rows-refused ]; then
          echo "Error: Not Authorized (token scope)" >&2
          exit 1
        fi
        edges_from "$(rows_page lookup)"
        echo "Railway API request completed" >&2
        exit 0
        ;;
      *serviceInstance\(serviceId:*)
        # The measured readable row read: f2-token-probe.sh's DOC_ROW, answered
        # in that document's own envelope. ONE document serves both the baseline
        # read and the watch, so the stub decides which read this is from the
        # leg's own state — no mutation recorded for this scenario yet means the
        # newest row is the pre-existing baseline; after the mutation the same
        # read is the leg judging what it did. A leg that read its baseline after
        # mutating, or re-read it between polls, would compare its own deploy
        # against itself and go red: the failure direction a pin should fail in.
        mutated=0
        [ -s "$STUB_API_LOG" ] && mutated=1
        kind=lookup
        [ "$mutated" = 0 ] && kind=baseline
        printf 'latest-%s %s\n' "$kind" "$*" >> "$STUB_ROWS_LOG"
        if [ "$kind" = baseline ]; then
          printf 'rows1\n' >> "$STUB_ROWS_LOG"
          n=0; [ -f "$STUB_BASELINE_COUNT" ] && n="$(cat "$STUB_BASELINE_COUNT")"
          n=$((n + 1)); printf '%s' "$n" > "$STUB_BASELINE_COUNT"
          # The reader's own failure shape: a non-zero exit with its sentence on
          # stderr. This is the cell pinning that the leg must not go back to
          # being silent about it — with the row read gone there is no baseline
          # to judge against, and the only acceptable output is a red leg that
          # says what failed.
          if [ "${STUB_MODE}" = rows-refused ]; then
            echo "Error: Not Authorized (token scope)" >&2
            exit 1
          fi
          # `baseline-5xx`: one transient refusal, then the same read succeeds.
          # The measured 503 was not transient, but a leg that cannot ride out a
          # dropped connection reds a release for nothing, and a leg that retries
          # forever hangs one. Both halves are checked: green after two attempts,
          # and exactly two attempts.
          if [ "${STUB_MODE}" = baseline-5xx ] && [ "$n" -le 1 ]; then
            echo "Error: Railway API request failed with HTTP 503 Service Unavailable (unconditional drop overload)" >&2
            exit 1
          fi
          # `latest-errors`: a refusal that arrives as HTTP 200 carrying errors[]
          # and NO `.data` — the shape this API uses for `Not Authorized` (see
          # the `refused` mutation scenario). A leg that reads a missing `.data`
          # as "an environment with no rows" would treat every refusal as a
          # blank slate and credit the pre-existing deployment as its own.
          if [ "${STUB_MODE}" = latest-errors ]; then
            printf '%s\n' '{"errors":[{"extensions":{"code":"INTERNAL_SERVER_ERROR"},"message":"Not Authorized"}]}'
            echo "Railway API request completed" >&2
            exit 0
          fi
          latest_from "$(rows_page baseline)"
          echo "Railway API request completed" >&2
          exit 0
        fi
        printf 'rows10\n' >> "$STUB_ROWS_LOG"
        # `rows-refused` refuses the read whenever it happens, not only before
        # the mutation: the scenario is "the row read does not answer", and a leg
        # that dropped its baseline guard must still hear a refusal in the poll.
        if [ "${STUB_MODE}" = rows-refused ]; then
          echo "Error: Not Authorized (token scope)" >&2
          exit 1
        fi
        latest_from "$(rows_page lookup)"
        echo "Railway API request completed" >&2
        exit 0
        ;;
    esac
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
    # The shape train 45234100845 hit on every staging leg at 18:33:15Z: the
    # name-resolved list call refuses with a non-zero exit and its sentence on
    # stderr only. The leg that swallowed it died 1.1 s after printing its
    # header, with nothing in the log to say why.
    if [ "${STUB_MODE}" = list-refused ]; then
      printf 'list-refused\n' >> "$STUB_LIST_LOG"
      echo "Error: No project linked. Run `railway link` first." >&2
      exit 1
    fi
    limit=10
    while [ $# -gt 0 ]; do
      if [ "$1" = --limit ]; then limit="${2:-10}"; shift 2; continue; fi
      shift
    done
    if [ "$limit" = 1 ]; then
      printf 'list1\n' >> "$STUB_LIST_LOG"
      rows_page baseline
      printf '\n'
      exit 0
    fi
    printf 'list10\n' >> "$STUB_LIST_LOG"
    rows_page lookup
    printf '\n'
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

# run_leg <stub-mode> -> "<rc> <up> <mutation> <watch-lookups> <name-resolved-list> <connection-doc>"
#
# Field 4 counts a watch lookup however it was fetched — `list10` from the
# name-resolved reader, `rows10` from the id-addressed connection, or `rows10`
# from the service-instance read — because "how many times did the leg look at
# the rows" is a statement about the verdict, not about the transport. Field 5
# pins the other half: a mutation leg that goes back to `railway deployment
# list` is the leg that died silently on 2026-11-23. Field 6 is the newest of
# the three: the `deployments(input:)` connection is the read that train
# 45302515868 was refused on with HTTP 503, so a leg that returns to it is
# visible as a non-zero count here even though the stub still answers it.
run_leg() {
  local mode="$1" rc
  : > "$work/up.$mode"; : > "$work/api.$mode"; : > "$work/list.$mode"
  : > "$work/rows.$mode"
  : > "$work/api_count.$mode"; : > "$work/poll_count.$mode"
  : > "$work/baseline_count.$mode"
  (
    cd "$work/tree" || exit 99
    STUB_MODE="$mode" \
      STUB_UP_LOG="$work/up.$mode" STUB_API_LOG="$work/api.$mode" \
      STUB_LIST_LOG="$work/list.$mode" STUB_ROWS_LOG="$work/rows.$mode" \
      STUB_API_COUNT="$work/api_count.$mode" \
      STUB_POLL_COUNT="$work/poll_count.$mode" \
      STUB_BASELINE_COUNT="$work/baseline_count.$mode" \
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
  printf '%s %s %s %s %s %s' "$rc" \
    "$(count "$work/up.$mode" '^railway up')" \
    "$(num "$work/api_count.$mode")" \
    "$(( $(count "$work/list.$mode" '^list10$') + $(count "$work/rows.$mode" '^rows10$') ))" \
    "$(count "$work/list.$mode" '^list')" \
    "$(count "$work/rows.$mode" '^connection-doc$')"
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
check "green: no name-resolved list call at all (a mutation leg is id-addressed)" "0" "$5"
check "green: no deployments(input:) connection call at all" "0" "$6"
# The row read is the probe's own document, aimed by ids and nothing else: the
# service id and the staging environment id are its only two variables, which is
# what makes it the same call run 45308408960 answered at 01:55:21Z.
check "green: the row read carried the service id, not the name" "yes" \
  "$(grep -q -- "--var s=$BACKEND_ID" "$work/rows.green" && echo yes || echo no)"
check "green: the row read carried the staging environment id" "yes" \
  "$(grep -q -- "--var e=$STAGING_ENV_ID" "$work/rows.green" && echo yes || echo no)"
check "green: the row read asked for no service NAME" "0" \
  "$(grep -c -- '--var s=backend\\|--var e=staging' "$work/rows.green")"
check "green: the token appears in no recorded row-read argv" "0" \
  "$(count "$work/rows.green" 'rlwy_stub_value_never_printed')"

# The 2026-11-23 18:33Z staging legs. All three printed
#     === deploying backend to staging (dda9d256…) ===
# and then exited 1 one second later with no other line in the entire log, which
# is why the lane looked like a Railway fault for an hour before anyone noticed
# the refusal was ours: the baseline read went through `railway deployment list`,
# that call refused, its stderr went to /dev/null, and `set -e` killed the leg
# before the guard written to catch exactly this could run. The leg that
# survives the same refusal is the point of this cell.
echo "=== the row read: a refused name-resolved list must not be a silent death"
out="$(run_leg list-refused)"; set -- $out
check "list-refused: the leg still deploys (exits 0)" "0" "$1"
check "list-refused: never ran railway up"            "0" "$2"
check "list-refused: sent exactly one mutation"       "1" "$3"
check "list-refused: never asked the CLI to resolve a name" "0" "$5"
check "list-refused: the log names the baseline row it read" "yes" \
  "$(grep -q "^baseline row before the mutation: $BASE_ID$" "$work/out.list-refused" && echo yes || echo no)"
check "list-refused: the log names the commit it deployed" "yes" \
  "$(grep -q 'deployed 1111111111.* (mutation)' "$work/out.list-refused" && echo yes || echo no)"
check "list-refused: the row read came through the api, not the CLI name lookup" "yes" \
  "$(grep -q 'rows10' "$work/rows.list-refused" && echo yes || echo no)"
check "list-refused: the row read is aimed by id" "yes" \
  "$(grep -q -- "--var e=$STAGING_ENV_ID" "$work/rows.list-refused" && echo yes || echo no)"
check "list-refused: the token appears in no recorded argv" "0" \
  "$(count "$work/rows.list-refused" 'rlwy_stub_value_never_printed')"

# The other half of the same lesson: when the row read itself is what refuses,
# the leg is allowed to be red — it just is not allowed to be quiet about it.
# Without this cell the fix could be reduced to `printf 'null'; return 0` (an
# honest-looking empty page) and the suite would still pass, while a real CI leg
# went back to dying 1.1 s in with no reason in the log.
out="$(run_leg rows-refused)"; set -- $out
check "rows-refused: the leg is RED (no baseline, no verdict)" "1" "$1"
check "rows-refused: sends NO mutation (it refuses to guess at 'new row')" "0" "$3"
check "rows-refused: the log says the row read failed" "yes" \
  "$(grep -q 'row read failed (rc=1)' "$work/out.rows-refused" && echo yes || echo no)"
check "rows-refused: the log names WHICH read failed" "yes" \
  "$(grep -q 'baseline row read failed' "$work/out.rows-refused" && echo yes || echo no)"
check "rows-refused: the log keeps the CLI's reason, not just a bare rc" "yes" \
  "$(grep -q 'Not Authorized' "$work/out.rows-refused" && echo yes || echo no)"
check "rows-refused: the log names the ids the read was aimed at" "yes" \
  "$(grep -q "service=$BACKEND_ID env=$STAGING_ENV_ID" "$work/out.rows-refused" && echo yes || echo no)"
check "rows-refused: the named guard still fires" "yes" \
  "$(grep -q 'could not read the pre-mutation' "$work/out.rows-refused" && echo yes || echo no)"
check "rows-refused: never ran railway up" "0" "$2"
# The retry ladder is bounded, and this is where that is measured: three
# attempts and no fourth. An unbounded ladder on the pre-mutation read is a leg
# that hangs a release instead of failing it, and a leg that gives up after one
# try is a leg that reds a release over one dropped connection.
check "rows-refused: retried the baseline read EXACTLY three times, no more" "3" \
  "$(count "$work/rows.rows-refused" '^rows1$')"
check "rows-refused: never fell back to the connection or the name lookup" "0" \
  "$(( $5 + $6 ))"

# A refusal shaped as HTTP 200 carrying errors[] rather than a non-zero exit —
# the shape this API uses for `Not Authorized`, and the one that a leg which
# parses "did the CLI succeed" instead of "did Railway answer" reads as a clean
# empty environment. Same required outcome as rows-refused, different mechanism:
# a missing `.data` must never become a blank slate to diff against.
out="$(run_leg latest-errors)"; set -- $out
check "latest-errors: an errors[] body is RED, not an empty environment" "1" "$1"
check "latest-errors: sends NO mutation" "0" "$3"
check "latest-errors: the log keeps the CLI's reason" "yes" \
  "$(grep -q 'Not Authorized' "$work/out.latest-errors" && echo yes || echo no)"
check "latest-errors: the named guard fires" "yes" \
  "$(grep -q 'could not read the pre-mutation' "$work/out.latest-errors" && echo yes || echo no)"
check "latest-errors: never ran railway up" "0" "$2"

# One dropped connection on the pre-mutation read must not be a red release: the
# same read made again answers, and the leg deploys.
out="$(run_leg baseline-5xx)"; set -- $out
check "baseline-5xx: a transient 503 on the baseline read does not kill the leg" "0" "$1"
check "baseline-5xx: sent exactly one mutation (it did not re-fire)" "1" "$3"
check "baseline-5xx: the second attempt succeeded and the leg went green" "yes" \
  "$(grep -q 'deployed 1111111111.* (mutation)' "$work/out.baseline-5xx" && echo yes || echo no)"
check "baseline-5xx: the refusal is still in the log" "yes" \
  "$(grep -q 'HTTP 503' "$work/out.baseline-5xx" && echo yes || echo no)"
check "baseline-5xx: stopped retrying once it had a baseline (2 reads, not 3)" "2" \
  "$(count "$work/rows.baseline-5xx" '^rows1$')"
check "baseline-5xx: the log names the baseline row it read" "yes" \
  "$(grep -q "^baseline row before the mutation: $BASE_ID$" "$work/out.baseline-5xx" && echo yes || echo no)"

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
# `latestDeployment: null` is a READABLE answer that names no row. Retrying it
# three times is the ladder working as designed; treating it as a blank slate
# would be the false green, and crediting the first row that appears after the
# mutation — whoever minted it — is exactly what the guard above exists to stop.
check "an unreadable baseline still retries the read a bounded 3 times" "3" \
  "$(count "$work/rows.no-baseline" '^rows1$')"
check "an unreadable baseline never ran railway up" "0" "$2"

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
# The row read, same rule: the ONLY staging row document with measured CI-side
# evidence behind it is f2-token-probe.sh's DOC_ROW — run 45308408960 resolved it
# through `railway api` with RAILWAY_TOKEN_STAGING from an unlinked runner and
# got row 2df11e51 SUCCESS. Byte-for-byte is the point: a drifted document is a
# second unmeasured claim, and the claim is what the 503 refused.
probe_row_doc="$(grep '^DOC_ROW=' "$probe")"
deploy_row_doc="$(grep '^DOC_ROW=' "$deploy")"
check "railway-deploy.sh sends the probe's row document verbatim" "$probe_row_doc" "$deploy_row_doc"
check "the row document resolves through serviceInstance, not a list" "yes" \
  "$(printf '%s' "$deploy_row_doc" | grep -q 'serviceInstance(serviceId:\$s, environmentId:\$e){ latestDeployment' && echo yes || echo no)"
# The connection that train 45302515868 was refused on must not be in the
# script any more. Pinned on `DeploymentListInput` rather than on the looser
# `deployments(input:)` because the prose in this file legitimately names the
# refused query, and a type name only ever appears in a document. The stub
# answers the connection in every scenario, so without this pin a revert would
# pass the behavioural cells silently.
check "railway-deploy.sh has no connection document of its own" "0" \
  "$(grep -c 'DeploymentListInput' "$deploy")"
check "no leg anywhere in this suite sent the deployments(input:) connection" "0" \
  "$(cat "$work"/rows.* 2>/dev/null | grep -c '^connection-doc$')"
check "no leg anywhere in this suite used the name-resolved list reader" "0" \
  "$(cat "$work"/list.* 2>/dev/null | grep -c '^list')"
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
# One reader, called twice: the row the leg diffs against and the row it judges
# come from the same document and the same transport. A watch that read through
# a different path than the deploy it is judging is a second way for a verdict
# and its evidence to disagree — and it is what this leg has done twice now.
check "the poll reads the newest row through the measured reader" "1" \
  "$(grep -c 'rows_page="$(latest_row_api lookup)"' "$deploy")"
check "exactly one place in the leg sends the row document" "1" \
  "$(grep -c 'railway api "\$DOC_ROW"' "$deploy")"
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
echo "ok — staging mutation leg pinned ($checks checks: 6 green legs, 9 red controls, the cutoff matrix, the readers, the retry ladder, guards and wiring)"
