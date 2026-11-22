#!/usr/bin/env bash
# test-railway-deploy-archive.sh — prove scripts/ci/railway-deploy.sh can build
# the UPLOAD ARCHIVE FROM THE COMMIT instead of from the working tree, and that
# it does so without changing the archive's SHAPE.
#
# WHY THIS EXISTS
# Staging's two frontend instances carry a Railway `rootDirectory`
# (`frontend-web` / `frontend-admin`), so the archive must be the REPO ROOT and
# Railway strips the prefix itself. The release chain therefore uploaded the
# WHOLE MONOREPO for an 8 MB app: 214,927,130 tracked bytes at 10f6f72b6, of
# which frontend-web/public alone is 105,513,272. Every staging frontend leg
# therefore shipped ~205 MB of dead weight, which is what made recovery from a
# laptop impossible (two `railway up` runs on this machine died HTTP 524 at 46 s
# and 20 s, each writing a FAILED, INERT deployment row).
#
# The build context is IDENTICAL either way: Railway strips the prefix, so
# today's context is `frontend-admin/` and the trimmed archive's context is
# `frontend-admin/` too. What changes is the size of the thing that has to
# travel, and where the bytes come from.
#
# WHERE THE BYTES COME FROM is the second half, and it is the part that matters
# for correctness rather than speed. The archive is cut with `git archive <sha>`
# — the COMMIT — so a working tree carrying uncommitted edits cannot leak them
# into a release. Cutting it from the working tree instead would ship whatever
# happened to be on the machine, which is exactly how a "released" build stops
# matching the sha it claims to carry.
#
# HOW IT WORKS
# A stub `railway` on PATH records its ARGV and its CWD, so the assertions can
# see both halves of the contract: the shape (repo root, no path argument, no
# --path-as-root) and the content (the committed tree, not the dirty one).
# Case 3 is the red control: without it, a suite that passes whatever the
# script does would prove nothing.
#
# Run:  bash scripts/ci/test-railway-deploy-archive.sh
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$repo_root/scripts/ci/railway-deploy.sh"

command -v jq >/dev/null || { echo "FAIL: jq is required"; exit 1; }
command -v git >/dev/null || { echo "FAIL: git is required"; exit 1; }
[ -f "$script" ] || { echo "FAIL: $script missing"; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"

cat > "$work/bin/railway" <<'STUB'
#!/usr/bin/env bash
# Records how `up` was called: its argv AND the directory it ran in.
cmd="${1:-}"; shift || true
case "$cmd" in
  up)
    : > "$STUB_ARGV"
    for a in "$@"; do printf '<%s>\n' "$a" >> "$STUB_ARGV"; done
    pwd > "$STUB_CWD"
    ls -A . | sort > "$STUB_CWD_LIST"
    rm -rf "$STUB_SNAPSHOT"
    mkdir -p "$STUB_SNAPSHOT"
    tar -cf - . | tar -xf - -C "$STUB_SNAPSHOT"
    echo "Indexing..."
    echo "Uploading..."
    exit 0
    ;;
  deployment)
    printf '[{"id":"00000000-0000-0000-0000-000000000001","createdAt":"2026-11-22T00:00:00.000Z","status":"SUCCESS","meta":{"cliMessage":"%s"}}]' "$SHA_STUB"
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

failures=0
check() { # <label> <expected> <actual>
  if [ "$2" = "$3" ]; then
    echo "PASS  $1"
  else
    echo "FAIL  $1 (expected [$2], got [$3])"
    failures=$((failures + 1))
  fi
}

# A tiny git repo with a commit, a service folder inside it, and a DIRTY
# working tree (an untracked file plus an edited tracked file). The commit is
# what a release must ship.
git -c init.defaultBranch=main init -q "$work/repo"
cd "$work/repo" || exit 99
mkdir -p frontend-admin/app
printf 'committed\n' > frontend-admin/app/page.tsx
printf 'tracked\n' > frontend-admin/keep.txt
git add -A >/dev/null 2>&1
git -c user.email=t@e -c user.name=t commit -qm "fixture"
FIXTURE_SHA="$(git rev-parse HEAD)"
export SHA_STUB="$FIXTURE_SHA"
# Dirty the tree the way a developer's checkout usually is.
printf 'uncommitted-junk\n' > frontend-admin/uncommitted.txt
printf 'EDITED-LOCALLY\n' > frontend-admin/keep.txt

run_deploy() { # <label> <extra-env...>  -> "<rc> <up-count>"
  local label="$1"; shift
  local counter="$work/up.$label" out="$work/out.$label"
  : > "$counter"
  (
    cd "$work/repo" || exit 99
    env SERVICE=frontend-admin RAILWAY_ENV=staging SHA="$FIXTURE_SHA" \
        RAILWAY_TOKEN=stub-token RAILWAY_PROJECT=stub-project \
        UPLOAD_PATH='' ROOT_FLAG='' BUILD_DIR='' ATTEMPTS=2 \
        RETRY_ATTEMPTS=1 RETRY_BASE_DELAY_S=0 \
        STUB_ARGV="$work/argv.$label" STUB_CWD="$work/cwd.$label" \
        STUB_CWD_LIST="$work/cwdlist.$label" STUB_SNAPSHOT="$work/snapshot.$label" \
        "$@" \
        PATH="$work/bin:$PATH" bash "$script"
  ) > "$out" 2>&1
  local rc=$?
  printf '%s %s\n' "$rc" "$(cat "$counter")"
  cp "$out" "$work/last-out.$label"
}

# --- 1. The shape: repo root, no path argument, no --path-as-root. ----------
read -r rc n <<<"$(run_deploy shape ARCHIVE_SUBDIR=frontend-admin)"
check "trimmed archive: the script exits 0" "0" "$rc"
if [ -f "$work/cwdlist.shape" ]; then
  top="$(tr '\n' ',' < "$work/cwdlist.shape")"
  check "trimmed archive: the upload runs from a directory holding ONLY the service folder" \
    "frontend-admin," "$top"
  check "trimmed archive: no positional path reached the CLI" "0" "$(grep -c '^<>$' "$work/argv.shape")"
  check "trimmed archive: --path-as-root did not leak" "0" "$(grep -c '^<--path-as-root>$' "$work/argv.shape")"
  check "trimmed archive: the service name is still passed" "1" "$(grep -c '^<frontend-admin>$' "$work/argv.shape")"
else
  check "trimmed archive: the stub recorded its cwd" "recorded" "missing"
fi

# --- 2. The CONTENT: the commit, not the dirty working tree. ----------------
if [ -d "$work/snapshot.shape" ]; then
  check "trimmed archive: the untracked local file is NOT in the archive" "0" \
    "$(find "$work/snapshot.shape" -name uncommitted.txt -print | wc -l | tr -d ' ')"
fi
# The edited tracked file must carry its COMMITTED content, so read it out of
# the archive directory the stub ran in.
if [ -d "$work/snapshot.shape" ]; then
  kept="$(cat "$work/snapshot.shape/frontend-admin/keep.txt" 2>/dev/null)"
  check "trimmed archive: a locally edited file ships its COMMITTED bytes" "tracked" "$kept"
  check "trimmed archive: the committed service file is present" "1" \
    "$( [ -f "$work/snapshot.shape/frontend-admin/app/page.tsx" ] && echo 1 || echo 0 )"
fi

# --- 3. The red control: a path that is not in the commit must NOT upload. ---
read -r rc n <<<"$(run_deploy missing ARCHIVE_SUBDIR=does-not-exist)"
[ "$rc" -ne 0 ] && nonzero=yes || nonzero=no
check "missing subdir: the script exits non-zero" "yes" "$nonzero"
check "missing subdir: the CLI was NEVER invoked (no inert deployment row)" "0" \
  "$( [ -f "$work/argv.missing" ] && echo 1 || echo 0 )"
check "missing subdir: the failure names the missing path" "yes" \
  "$(grep -q 'does-not-exist' "$work/last-out.missing" && echo yes || echo no)"

# --- 4. Without the opt-in, the old behaviour is untouched. ------------------
read -r rc n <<<"$(run_deploy legacy UPLOAD_PATH=frontend-admin ROOT_FLAG=--path-as-root)"
check "legacy shape: the script still exits 0" "0" "$rc"
check "legacy shape: the positional path still reached the CLI" "2" \
  "$(grep -c '^<frontend-admin>$' "$work/argv.legacy")"
check "legacy shape: --path-as-root still reached the CLI" "1" \
  "$(grep -c '^<--path-as-root>$' "$work/argv.legacy")"

echo
if [ "$failures" -eq 0 ]; then
  echo "ok — the release archive can be cut from the commit without changing its shape"
  exit 0
fi
echo "$failures assertion(s) failed"
exit 1
