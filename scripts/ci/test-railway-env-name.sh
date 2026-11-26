#!/usr/bin/env bash
# test-railway-env-name.sh — pin the 2026-11-24 root cause of F2 so it cannot come
# back wearing the name of a variable.
#
# WHAT WAS MEASURED (docs/devops/railway-upload-fault-report.md, Episode 25):
# the Railway CLI does NOT read RAILWAY_ENV as "the name of my environment". It
# reads it as an INTERNAL API-STAGE selector and changes the GraphQL host:
#
#   RAILWAY_ENV=staging (also STAGING, dev)
#     -> https://backboard.railway-staging.com/graphql/v2
#        body: "unconditional drop overload" + HTTP 503, never JSON
#   unset, or development / production / preview / zzz
#     -> https://backboard.railway.com/graphql/v2 (the real API, answers normally)
#
# Seen with a dead proxy, which prints the URL the CLI chose without sending:
#   error sending request for url (https://backboard.railway-staging.com/graphql/v2)
# A non-JSON 503 is exactly the sentence every `deploy Staging` leg has printed
# since 2026-11-16 — `Failed to fetch: error decoding response body /
# expected value at line 1 column 1` — and it is why the probe workflows, which
# never set RAILWAY_ENV, answer the same document forty seconds later.
#
# So every leg in this repo addresses its environment by FLAG
# (`--environment "$RAILWAY_ENV_NAME"`) and hands the name in a variable the CLI
# ignores, and the deploy/root-shape scripts additionally `unset RAILWAY_ENV` so
# a caller that exports the poisoned name cannot reach the CLI anyway.
#
# These checks are the three things that make that durable:
#   1. the scripts REQUIRE the safe name (a leg configured only the old way fails
#      loudly instead of silently redeploying to Railway's internal stage);
#   2. no `railway` process ever sees RAILWAY_ENV in its environment, even when
#      the caller exports it;
#   3. no workflow exports the poisoned key any more.
#
# Stub-driven, no network. Run from the repository root.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 99
ROOT="$PWD"
deploy="$ROOT/scripts/ci/railway-deploy.sh"
shape="$ROOT/scripts/ci/railway-root-shape.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/tree"

SHA_STUB=0123456789012345678901234567890123456789
BACKEND_ID=70de07d8-c058-4221-b645-61c4f1ac7aa5
STAGING_ENV_ID=6b5f27a3-a290-4574-a977-363eb21d43ad

# The stub records ONE line per CLI call: the argv (truncated), whether
# RAILWAY_ENV was in the environment, and what the safe name was set to. It
# never touches RAILWAY_TOKEN.
cat > "$work/bin/railway" <<'STUB'
#!/usr/bin/env bash
present=absent
[ -z "${RAILWAY_ENV+x}" ] || present=present
printf 'RAILWAY_ENV=%s RAILWAY_ENV_NAME=%s argv=%s\n' \
  "$present" "${RAILWAY_ENV_NAME:-absent}" "$(printf '%s ' "$@" | cut -c1-120)" >> "$STUB_ENV_LOG"

case "$1" in
  api)
    if [ "${STUB_MODE:-refuse}" = answer ]; then
      printf '{"data":{"project":{"environments":[{"id":"e1","name":"staging","serviceInstances":[{"id":"i1","rootDirectory":"backend","service":{"id":"s1","name":"backend"}}]}]}}}\n'
      exit 0
    fi
    printf 'unconditional drop overload\nRailway API request failed with HTTP 503 Service Unavailable\n'
    exit 1
    ;;
  up)
    printf 'Failed to fetch: error decoding response body\n'
    exit 1
    ;;
  *)
    printf 'stub railway: unexpected invocation: %s\n' "$*" >&2
    exit 1
    ;;
esac
STUB
chmod +x "$work/bin/railway"
printf '#!/usr/bin/env bash\nexit 0\n' > "$work/bin/sleep"
chmod +x "$work/bin/sleep"

failures=0
checks=0
check() { # <label> <expected> <actual>
  checks=$((checks + 1))
  if [ "$2" = "$3" ]; then
    echo "PASS  $1"
  else
    echo "FAIL  $1 (expected [$2], got [$3])"
    failures=$((failures + 1))
  fi
}

# run_deploy <method> <extra env...> -> rc; writes the call log to $work/env.<method>
run_deploy() {
  local method="$1"; shift
  : > "$work/env.$method"
  (
    cd "$work/tree" || exit 99
    STUB_ENV_LOG="$work/env.$method" STUB_MODE=refuse PATH="$work/bin:$PATH" \
      SERVICE=backend SHA="$SHA_STUB" RAILWAY_TOKEN=stub-token-never-printed \
      RAILWAY_PROJECT=00000000-0000-0000-0000-000000000000 \
      DEPLOY_METHOD="$method" SERVICE_ID="$BACKEND_ID" \
      RAILWAY_ENVIRONMENT_ID="$STAGING_ENV_ID" \
      UPLOAD_PATH=backend ROOT_FLAG=--path-as-root \
      ATTEMPTS=1 MUT_RETRY_ATTEMPTS=1 MUT_RETRY_BASE_DELAY_S=0 \
      RETRY_ATTEMPTS=1 RETRY_BASE_DELAY_S=0 \
      env "$@" bash "$deploy" >"$work/out.$method" 2>&1
  )
}

count() { printf '%s' "$(grep -c "$2" "$1" 2>/dev/null)" || true; }

echo "=== 1. the leg addresses its environment by flag, in a name the CLI ignores"
run_deploy mutation RAILWAY_ENV_NAME=staging RAILWAY_ENV=staging || true
check "mutation leg reached the CLI" "yes" "$([ "$(count "$work/env.mutation" '^RAILWAY_ENV=')" -gt 0 ] && echo yes || echo no)"
check "no CLI call inherited RAILWAY_ENV (mutation)" "0" "$(count "$work/env.mutation" 'RAILWAY_ENV=present')"
check "the safe name reached the CLI (mutation)" "yes" "$([ "$(count "$work/env.mutation" 'RAILWAY_ENV_NAME=staging')" -gt 0 ] && echo yes || echo no)"

run_deploy upload RAILWAY_ENV_NAME=staging RAILWAY_ENV=staging || true
check "upload leg ran railway up" "1" "$(count "$work/env.upload" 'argv=up ')"
check "up still names the environment by flag" "1" "$(count "$work/env.upload" 'argv=up .*--environment staging')"
check "no CLI call inherited RAILWAY_ENV (upload)" "0" "$(count "$work/env.upload" 'RAILWAY_ENV=present')"

echo "=== 2. a leg configured only the old way refuses instead of guessing"
run_deploy mutation RAILWAY_ENV=staging || true
check "RAILWAY_ENV alone is not accepted" "yes" "$(grep -q 'RAILWAY_ENV_NAME' "$work/out.mutation" && echo yes || echo no)"
check "and it reached no CLI at all" "0" "$(count "$work/env.mutation" '^RAILWAY_ENV=')"

echo "=== 3. the upload-shape resolver, which is also a railway api call"
: > "$work/env.shape"
(
  cd "$work/tree" || exit 99
  STUB_ENV_LOG="$work/env.shape" STUB_MODE=answer PATH="$work/bin:$PATH" \
    SERVICE=backend RAILWAY_PROJECT=00000000-0000-0000-0000-000000000000 \
    RAILWAY_TOKEN=stub-token-never-printed RAILWAY_ENV_NAME=staging RAILWAY_ENV=staging \
    bash "$shape" >"$work/out.shape" 2>&1
) || true
check "resolver reached the CLI" "1" "$(count "$work/env.shape" '^RAILWAY_ENV=')"
check "resolver call inherited no RAILWAY_ENV" "0" "$(count "$work/env.shape" 'RAILWAY_ENV=present')"
: > "$work/env.shape2"
(
  cd "$work/tree" || exit 99
  STUB_ENV_LOG="$work/env.shape2" STUB_MODE=answer PATH="$work/bin:$PATH" \
    SERVICE=backend RAILWAY_PROJECT=00000000-0000-0000-0000-000000000000 \
    RAILWAY_TOKEN=stub-token-never-printed RAILWAY_ENV=staging \
    bash "$shape" >"$work/out.shape2" 2>&1
) || true
check "resolver refuses without the safe name" "yes" "$(grep -q 'RAILWAY_ENV_NAME' "$work/out.shape2" && echo yes || echo no)"
check "and it reached no CLI at all" "0" "$(count "$work/env.shape2" '^RAILWAY_ENV=')"

echo "=== 4. no workflow may export the poisoned key"
bad="$(grep -rn '^[[:space:]]*RAILWAY_ENV:' "$ROOT/.github/workflows" 2>/dev/null | wc -l | tr -d ' ')"
check "workflows export no RAILWAY_ENV:" "0" "$bad"
# The value form catches a shell assignment inside a `run:` block. Comment lines
# are exempt because they quote past job logs — `railway-deploy.sh: line 66:
# RAILWAY_ENV: required: RAILWAY_ENV` is evidence, and a gate that punishes
# quoting the old name is a gate that gets its history deleted to go green.
bad2="$(grep -rn 'RAILWAY_ENV=\$\|RAILWAY_ENV: ' "$ROOT/.github/workflows" 2>/dev/null \
  | sed 's/^[^:]*:[0-9]*://' | grep -v 'RAILWAY_ENV_NAME' \
  | grep -vE '^[[:space:]]*#' | wc -l | tr -d ' ')"
check "workflows export no RAILWAY_ENV value either" "0" "$bad2"

echo "=== 5. the scripts themselves carry no bare RAILWAY_ENV use"
for f in scripts/ci/railway-deploy.sh scripts/ci/railway-root-shape.sh scripts/ci/railway-smoke.sh; do
  bare="$(grep -n 'RAILWAY_ENV\b' "$ROOT/$f" 2>/dev/null | grep -v 'RAILWAY_ENV_NAME' | grep -v 'unset RAILWAY_ENV' | grep -v '#' | wc -l | tr -d ' ')"
  check "$f uses only the safe name" "0" "$bare"
done

echo
if [ "$failures" -gt 0 ]; then
  echo "FAIL: $failures/$checks checks failed"
  exit 1
fi
echo "ok: $checks checks — no railway CLI call in this repo can be routed to Railway's internal stage by RAILWAY_ENV"
