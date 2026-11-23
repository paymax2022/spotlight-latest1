#!/usr/bin/env bash
# Gate for scripts/check-client-secrets.sh.
#
# The guard's tree-wide rules were added because two live Railway project tokens
# sat in the tracked root template .env.dev.example and nothing — not the CI
# hygiene lane, not the .githooks/pre-commit hook — said so. A green suite does not
# prove a predicate bites, so this file runs the guard against a throwaway git repo
# and asserts BOTH directions: every mutant reddens, and the tree greens back up.
# A case that passes while the rule is dead code is the failure this file exists to
# prevent, so each case starts from the same recorded base commit.
#
# Hermetic: no network, no repo state, one mktemp git repo. The fake token is
# assembled at run time, so this file never contains a value its own guard matches
# (the guard also excludes itself by path, which case 1 proves).
#
# Run:  bash scripts/ci/test-check-client-secrets.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
GUARD="$HERE/../check-client-secrets.sh"
[ -f "$GUARD" ] || { echo "FAIL: guard not found at $GUARD"; exit 3; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
REPO="$WORK/repo"
mkdir -p "$REPO/scripts" "$REPO/backend" "$REPO/docs"
cp "$GUARD" "$REPO/scripts/check-client-secrets.sh"

# 48 alnum chars after the prefix — live-shaped, not a real credential.
fake_token() { printf 'rlwy_proj_%s' "$(printf 'A1b2%.0s' $(seq 1 12))"; }

cd "$REPO" || exit 3
git init -q .
git config user.email gate@example.test
git config user.name gate
printf 'FOO=bar\nWS_TICKET_SIGNING_SECRET=dev-ws-ticket-secret-change-me\n' > .env.dev.example
printf 'NEXT_PUBLIC_API_BASE_URL=https://api.example.test\n' > backend/.env.example
printf '# token table\nrlwy_proj_****wtix\n' > docs/deployment-matrix.md
git add -A
git commit -qm base
BASE="$(git rev-parse HEAD)"

pass=0
fail=0

# expect <want_exit> <label> — commit whatever the case wrote, run the guard,
# then hard-reset to the base commit so the next case sees the same tree.
expect() {
  local want="$1" label="$2" out rc
  git add -A >/dev/null 2>&1 || true
  git commit -qm "$label" >/dev/null 2>&1 || true
  out="$(bash scripts/check-client-secrets.sh 2>&1)"
  rc=$?
  if [ "$rc" -eq "$want" ]; then
    echo "  ok   $label (exit $rc)"
    pass=$((pass + 1))
  else
    echo "  FAIL $label: exit $rc, wanted $want"
    printf '%s\n' "$out" | sed 's/^/         /'
    fail=$((fail + 1))
  fi
  git reset --hard -q "$BASE"
  git clean -fdq
}

echo "case 1: clean tree passes (also proves the guard does not self-flag)"
expect 0 "clean"

echo "case 2: live provider token pasted into a tracked .env template is caught"
printf 'railway_toke_staging=%s\n' "$(fake_token)" >> .env.dev.example
expect 1 "token-in-env-template"

echo "case 3: the same token anywhere else in tracked content is caught"
printf 'staging token: %s\n' "$(fake_token)" > docs/note.md
expect 1 "token-in-plain-doc"

echo "case 4: the **** masked preview the deployment matrix publishes stays green"
printf 'staging re-mint: rlwy_proj_****FCjl, revoked: rlwy_proj_****wtix\n' > docs/rotated.md
expect 0 "masked-preview-still-green"

echo "case 5: a tracked live .env snapshot is refused (runbook Step 4)"
printf 'FOO=bar\n' > .env.local
expect 1 "tracked-env-snapshot"

echo "case 6: a timestamped Local-History .env snapshot is refused"
printf 'FOO=bar\n' > .env_20261119120000.local
expect 1 "tracked-env-timestamped-snapshot"

echo "case 7: *.example / *.template stay exempt even inside a scanned root"
mkdir -p frontend-web
printf 'NEXT_PUBLIC_API_BASE_URL=https://www.example.test\n' > frontend-web/.env.production.example
expect 0 "template-suffix-exempt"

echo ""
echo "check-client-secrets gate: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
echo "CLEAN"
