#!/usr/bin/env bash
# test-railway-root-shape.sh — prove scripts/ci/railway-root-shape.sh reads each
# Railway instance's live `rootDirectory` and turns it into the upload shape
# `railway up` needs, and prove this test can still see it get that wrong.
#
# WHY THIS EXISTS
# scripts/ci/railway-deploy.sh's header records the cost of guessing this shape:
# uploading the repo root to an instance whose rootDirectory is unset builds the
# MONOREPO, the upload reports SUCCESS, and the app then 404s everything
# (development's smoke failed with "/admin/login answered 404" on 2026-11-16, and
# the same commit re-uploaded with --path-as-root returned 200 on that same host).
# Uploading a service folder to an instance that HAS a rootDirectory dies
# client-side with "prefix not found". Both mistakes look like a successful upload.
# release.yml hardcodes the answer per environment in three matrices; a manual lane
# (the production frontend-web upload in docs/ops/admin-console-production-errors-2026-11-20.md)
# has to derive it, so the derivation is what this test pins.
#
# Case 5 is the one that matters most: an instance whose rootDirectory names a
# directory that does not exist in the repo makes Railway build an EMPTY context
# and still report SUCCESS. Silently passing that through is how you deploy nothing
# and watch a green pipeline.
#
# Run:  bash scripts/ci/test-railway-root-shape.sh
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$repo_root/scripts/ci/railway-root-shape.sh"

[ -f "$script" ] || { echo "FAIL: $script missing"; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"

# The stub answers `railway api` with whatever JSON STUB_JSON names, so each case
# controls the LIVE rootDirectory without touching Railway. It records that it was
# called at all — a resolver that hardcodes an answer instead of asking would pass
# cases 1-3 by accident and this file would be decoration.
cat > "$work/bin/railway" <<'STUB'
#!/usr/bin/env bash
cmd="${1:-}"; shift || true
case "$cmd" in
  api)
    : > "$STUB_CALLED"
    cat "$STUB_JSON"
    exit "${STUB_RC:-0}"
    ;;
  *)
    echo "stub railway: unexpected invocation: $cmd $*" >&2
    exit 1
    ;;
esac
STUB
chmod +x "$work/bin/railway"

# --- canned API answers -------------------------------------------------------
# Built with json.dumps rather than typed out, because a hand-balanced
# {"edges":[{...}]} block is exactly the kind of fixture that quietly becomes
# invalid JSON and then reports every case as "the resolver refused". The jq -e
# loop below is the guard: an unreadable fixture fails the run instead of the
# resolver.
# Shapes are the ones measured 2026-11-22 against project e7dca861: production has
# rootDirectory unset for all three services, staging sets it for both frontends,
# and backend is unset everywhere. One instance reports "" to prove the resolver
# reads an empty rootDirectory as unset, not as "no such instance".
python3 - "$work" <<'PY'
import json, sys
w = sys.argv[1]
def inst(rd, svc): return {"node": {"rootDirectory": rd, "service": {"name": svc}}}
def env(name, instances):
    return {"node": {"name": name, "serviceInstances": {"edges": instances}}}
def doc(envs):
    return {"data": {"project": {"environments": {"edges": envs}}}}
fixtures = {
    "prod-web": doc([
        env("staging", [inst("frontend-web", "frontend-web"),
                        inst("frontend-admin", "frontend-admin"),
                        inst(None, "backend")]),
        env("production", [inst(None, "frontend-web"),
                           inst("", "frontend-admin"),
                           inst(None, "backend")]),
    ]),
    # An instance whose rootDirectory names a directory this repo does not have:
    # Railway would build an empty context and call it SUCCESS.
    "wrong-root": doc([env("production", [inst("web-app", "frontend-web")])]),
    # The environment exists but the service does not.
    "absent": doc([env("production", [inst(None, "backend")])]),
}
for name, payload in fixtures.items():
    with open(f"{w}/{name}.json", "w") as fh:
        json.dump(payload, fh)
PY
for fixture in prod-web wrong-root absent; do
  jq -e . "$work/$fixture.json" >/dev/null 2>&1 \
    || { echo "FAIL: the $fixture fixture is not valid JSON"; exit 1; }
done
printf 'railway said: not found\n{\n' > "$work/garbage.json"

failures=0
check() { # <label> <expected> <actual>
  if [ "$2" = "$3" ]; then
    echo "PASS  $1"
  else
    echo "FAIL  $1 (expected [$2], got [$3])"
    failures=$((failures + 1))
  fi
}

# Run the resolver. $1 = json file, $2 = SERVICE, $3 = RAILWAY_ENV_NAME.
# Echoes "exit|UPLOAD_PATH|ROOT_FLAG|BUILD_DIR|called".
run_shape() {
  local out rc called up flag bd
  rm -f "$work/called"
  out="$(cd "$repo_root" && STUB_JSON="$1" STUB_CALLED="$work/called" \
          SERVICE="$2" RAILWAY_ENV_NAME="$3" RAILWAY_PROJECT=stub-project \
          PATH="$work/bin:$PATH" bash "$script" 2>"$work/err")"
  rc=$?
  called=no; [ -f "$work/called" ] && called=yes
  up=""; flag=""; bd=""
  # Cleared first: eval only assigns the names a case emits, so a refused run
  # (which prints nothing) must read as "no shape" rather than last case's value.
  unset UPLOAD_PATH ROOT_FLAG BUILD_DIR
  eval "$(printf '%s\n' "$out" | grep -E "^(UPLOAD_PATH|ROOT_FLAG|BUILD_DIR)=" )"
  # Read back the names the resolver actually emits. Copying them into locals is
  # what lets every case below assert on one pipe-delimited line.
  up="${UPLOAD_PATH-}"; flag="${ROOT_FLAG-}"; bd="${BUILD_DIR-}"
  printf '%s|%s|%s|%s|%s\n' "$rc" "$up" "$flag" "$bd" "$called"
}

# --- 1. production/frontend-web: rootDirectory unset -> the folder IS the root. --
IFS='|' read -r rc up flag bd called <<<"$(run_shape "$work/prod-web.json" frontend-web production )"
check "prod web: exits 0" "0" "$rc"
check "prod web: asks the API instead of assuming" "yes" "$called"
check "prod web: UPLOAD_PATH is the service folder" "frontend-web" "$up"
check "prod web: ROOT_FLAG is --path-as-root" "--path-as-root" "$flag"
check "prod web: a frontend stamps no BUILD_DIR" "" "$bd"

# --- 2. staging/frontend-web: rootDirectory set -> ship the repo root. ----------
IFS='|' read -r rc up flag bd called <<<"$(run_shape "$work/prod-web.json" frontend-web staging )"
check "staging web: exits 0" "0" "$rc"
check "staging web: UPLOAD_PATH is empty (archive = repo root)" "" "$up"
check "staging web: no --path-as-root (that would trip 'prefix not found')" "" "$flag"

# --- 3. staging/backend: unset there too, and it is the one service that stamps. -
IFS='|' read -r rc up flag bd called <<<"$(run_shape "$work/prod-web.json" backend staging )"
check "staging backend: exits 0" "0" "$rc"
check "staging backend: UPLOAD_PATH=backend" "backend" "$up"
check "staging backend: ROOT_FLAG is --path-as-root" "--path-as-root" "$flag"
check "staging backend: BUILD_DIR=backend (the Dockerfile reads BUILD_COMMIT)" "backend" "$bd"

# --- 4. an empty string and a null mean the same thing. -------------------------
IFS='|' read -r rc up flag bd called <<<"$(run_shape "$work/prod-web.json" frontend-admin production )"
check "prod admin: rootDirectory \"\" is treated as unset" "frontend-admin" "$up"
check "prod admin: ROOT_FLAG is --path-as-root" "--path-as-root" "$flag"

# --- 5. the red control: a rootDirectory that names no directory in the repo. ----
# Railway builds an empty context here and reports SUCCESS. The resolver must
# refuse rather than hand the caller a shape that silently deploys nothing.
IFS='|' read -r rc up flag bd called <<<"$(run_shape "$work/wrong-root.json" frontend-web production )"
[ "$rc" -ne 0 ] && refused=yes || refused=no
check "phantom rootDirectory: the resolver refuses (exit non-zero)" "yes" "$refused"
check "phantom rootDirectory: it emits no eval-able shape" "" "$up"
grep -qi 'web-app' "$work/err" && named=yes || named=no
check "phantom rootDirectory: the error names the directory it could not find" "yes" "$named"

# --- 6. an unknown service in a known environment is not "unset". ---------------
IFS='|' read -r rc up flag bd called <<<"$(run_shape "$work/absent.json" frontend-web staging )"
[ "$rc" -ne 0 ] && stopped=yes || stopped=no
check "missing instance: the resolver does not invent a shape" "yes" "$stopped"
grep -qi 'frontend-web' "$work/err" && svc=yes || svc=no
check "missing instance: the error says which service it looked for" "yes" "$svc"

# --- 7. a non-JSON answer fails loudly. ----------------------------------------
IFS='|' read -r rc up flag bd called <<<"$(run_shape "$work/garbage.json" frontend-web production )"
[ "$rc" -ne 0 ] && loud=yes || loud=no
check "garbage response: exits non-zero instead of defaulting" "yes" "$loud"
check "garbage response: no shape is emitted" "" "$up"

echo
if [ "$failures" -eq 0 ]; then
  echo "all railway-root-shape cases passed"
  exit 0
fi
echo "$failures railway-root-shape case(s) FAILED"
exit 1
