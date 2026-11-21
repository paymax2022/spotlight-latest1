#!/usr/bin/env bash
# test-prod-ship-scope.sh — prove scripts/ci/prod-ship-scope.sh decides correctly
# whether a push to `prod` should put a new backend image in front of production.
#
# WHY A GATE ON THE PUSH RATHER THAN DEPLOY-ON-EVERYTHING
# `ci.yml` triggers on push to prod with only `**.md` / `docs/**` ignored, so a
# commit that touches nothing but a workflow or the admin console would otherwise
# rebuild the 25 MB Go image and roll a fresh container in front of live traffic
# for no reason. Every automatic writer of production needs a reason to write.
# `backend/**` is that reason: backend/Dockerfile:11 is `COPY . .` against a build
# context that `railway up backend --path-as-root` makes the `backend/` folder, so
# the image consumes NOTHING outside it. Pin that here, because if the Dockerfile
# ever COPYs from elsewhere, this test is where the missed dependency gets
# noticed — not in production.
#
# THE MIGRATION RULE IS A HARD STOP, NOT A SKIP
# supabase/migrations/** in the same push means code that expects a schema the
# production database may not have yet. This lineage has no automatic production
# apply (release.yml's migrate-production is a main-lineage job, and prod's DB is
# driven by the manual ops lanes), so the deploy refuses and says what to do.
# Refusing LOUDLY matters: a silent skip reads as "nothing to ship" and the
# release stalls unnoticed.
#
# WHAT MAKES THIS SUITE CAPABLE OF FAILING
# Cases 2, 2b and 3 assert `ship=false`: a script that always ships passes case 1
# and dies here. Case 4/5 assert exit 1: a script that lost the migration guard
# dies there. Case 6/7 assert the fail-open, so a script that skipped on an
# unresolvable range dies. To see it: delete the `^backend/` predicate in a scratch
# copy and re-run — cases 2/2b/3 go red. A suite that prints PASS whatever the
# script does is not a gate.
#
# Run:  bash scripts/ci/test-prod-ship-scope.sh
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$repo_root/scripts/ci/prod-ship-scope.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

pass=0
failn=0
ok()  { printf 'PASS  %s\n' "$*"; pass=$((pass + 1)); }
bad() { printf 'FAIL  %s\n' "$*"; failn=$((failn + 1)); }
check() { # check <label> <actual> <want>
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 — got '$2', want '$3'"; fi
}
has() { # has <label> <needle> <haystack>
  if printf '%s' "$3" | grep -qF -- "$2"; then
    ok "$1"
  else
    bad "$1 — '$2' absent from output"
    printf '%s\n' "$3" | sed 's/^/        | /'
  fi
}
hasnt() {
  if printf '%s' "$3" | grep -qF -- "$2"; then bad "$1 — '$2' present but must not be"; else ok "$1"; fi
}

[ -f "$script" ] || { echo "FAIL: $script missing"; exit 1; }

ZERO=0000000000000000000000000000000000000000

# ── a throwaway repo that behaves like a prod branch ──────────────────────────
tree="$work/tree"
mkdir -p "$tree/backend/internal" "$tree/frontend-web" "$tree/supabase/migrations" \
         "$tree/docs" "$tree/backend-extra"
printf 'package a\n' > "$tree/backend/internal/a.go"
printf 'x\n' > "$tree/frontend-web/page.tsx"
printf '# guide\n' > "$tree/docs/guide.md"
printf 'not the image\n' > "$tree/backend-extra/readme.txt"
git -C "$tree" init -q
git -C "$tree" config user.email ci@example.invalid
git -C "$tree" config user.name ci
git -C "$tree" add -A >/dev/null
git -C "$tree" commit -qm seed
base="$(git -C "$tree" rev-parse HEAD)"

# commit <message> <file...> — appends to the current tip.
commit() {
  local msg="$1"; shift
  local f
  for f in "$@"; do
    # mkdir -p: `git reset --hard` prunes a directory it has emptied, so a case
    # that follows a migration case would otherwise append to a path that no
    # longer exists and silently commit nothing.
    mkdir -p "$(dirname "$tree/$f")"
    printf '%s\n' "$msg" >> "$tree/$f"
  done
  git -C "$tree" add -A >/dev/null
  git -C "$tree" commit -qm "$msg" >/dev/null
  git -C "$tree" rev-parse HEAD
}

# fresh <message> <file...> -> a head whose diff from $base is EXACTLY these files.
# Without this every case inherits the previous case's commit, and a range like
# base..head then contains an earlier case's backend/ or migration file — which is
# how "frontend only, so skip" once read as ship=true and case 8 read as a refused
# migration push. Each assertion owns one range or it asserts nothing.
fresh() {
  local msg="$1"; shift
  git -C "$tree" reset -q --hard "$base"
  commit "$msg" "$@"
}

# run <args...> -> sets OUT (the GITHUB_OUTPUT file), RB (combined output), RC.
# GITHUB_OUTPUT is the real mechanism, so the suite drives the real mechanism.
run() {
  local out="$work/out"
  : > "$out"
  RB="$( cd "$tree" && GITHUB_OUTPUT="$out" bash "$script" "$@" 2>&1 )"
  RC=$?
  OUT="$(cat "$out" 2>/dev/null || true)"
}
ship_of() { printf '%s' "$OUT" | sed -n 's/^ship=//p' | head -1; }

# ── 1. backend changed -> ship ────────────────────────────────────────────────
head="$(fresh 'change the api' backend/internal/a.go)"
run --before "$base" --sha "$head"
check '1 backend/** triggers the deploy' "$(ship_of)" 'true'
check '1 exits 0' "$RC" '0'
has '1 states the reason' 'backend' "$RB"

# ── 2. no backend content -> skip, quietly ────────────────────────────────────
head="$(fresh 'frontend only' frontend-web/page.tsx docs/guide.md)"
run --before "$base" --sha "$head"
check '2 non-backend push skips the deploy' "$(ship_of)" 'false'
check '2 exits 0' "$RC" '0'
hasnt '2 no ::error:: for a plain skip' '::error::' "$RB"

# `backend-extra/` must not read as `backend/` — the anchor is the whole rule.
head="$(fresh 'sibling dir' backend-extra/readme.txt)"
run --before "$base" --sha "$head"
check '2b backend-extra/ is not backend/' "$(ship_of)" 'false'

# ── 3. empty range -> skip ────────────────────────────────────────────────────
run --before "$base" --sha "$base"
check '3 an empty range ships nothing' "$(ship_of)" 'false'
check '3 exits 0' "$RC" '0'

# ── 4. migrations in the push -> hard stop ────────────────────────────────────
head="$(fresh 'new schema + code' backend/internal/a.go supabase/migrations/20271900000000_x.sql)"
run --before "$base" --sha "$head"
check '4 migration push exits 1 (no code ahead of schema)' "$RC" '1'
has '4 the error names migrations' 'migration' "$RB"
has '4 the error says the production database is not auto-applied' 'database' "$RB"
has '4 as an annotation CI shows' '::error::' "$RB"
hasnt '4 and does not claim it is shipping' 'ship=true' "$OUT"

# ── 5. migration-only push refuses too (never a silent skip) ──────────────────
head="$(fresh 'schema only' supabase/migrations/20271900000001_y.sql)"
run --before "$base" --sha "$head"
check '5 migration-only push also exits 1' "$RC" '1'

# ── 6/7. unresolvable range -> fail OPEN ─────────────────────────────────────
# A force-push or a first push reports 40 zeros / an object the runner does not
# have. Skipping on "I could not work out the diff" would mean production stops
# receiving releases the moment branch history is rewritten, so unknown resolves to
# ship: what just passed every gate on prod IS what prod should be serving.
run --before "$ZERO" --sha "$(git -C "$tree" rev-parse HEAD)"
check '6 zero before-sha ships' "$(ship_of)" 'true'
check '6 exits 0' "$RC" '0'
has '6 announces the fail-open' '::warning::' "$RB"

run --before 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' --sha "$(git -C "$tree" rev-parse HEAD)"
check '7 unknown before-sha ships' "$(ship_of)" 'true'
has '7 and says so' '::warning::' "$RB"

# A resolvable pair whose history is not linear still classifies by TREE, because
# `git diff a b` compares trees. Pinned so nobody adds an ancestry test that would
# make a rebased prod branch fail open on every push.
git -C "$tree" reset -q --hard "$base"
mkdir -p "$tree/side" && printf 's\n' > "$tree/side/x"
git -C "$tree" add -A >/dev/null && git -C "$tree" commit -qm side >/dev/null
side="$(git -C "$tree" rev-parse HEAD)"          # base + side/x
git -C "$tree" reset -q --hard "$base"
head="$(commit 'after reset' backend/internal/a.go)"   # base + a.go — not a descendant of $side
run --before "$side" --sha "$head"
check '8 non-ancestor but resolvable: classified by tree diff' "$(ship_of)" 'true'
hasnt '8 no fail-open warning when both objects exist' '::warning::' "$RB"

# ── 9. usage errors are refusals, not guesses ─────────────────────────────────
RB="$( cd "$tree" && bash "$script" --before "$base" 2>&1 )"; RC=$?
check '9 missing --sha exits 2' "$RC" '2'
has '9 and prints usage' 'usage' "$RB"
RB="$( cd "$tree" && bash "$script" --before "$base" --sha "$base" --wat 2>&1 )"; RC=$?
check '9b unknown flag exits 2' "$RC" '2'
RB="$( cd "$tree" && bash "$script" --before "$base" --sha 'not-a-sha' 2>&1 )"; RC=$?
check '9c an unresolvable --sha exits non-zero' "$RC" '1'

# ── 10. a human running it with no GITHUB_OUTPUT must not crash ───────────────
head="$(fresh 'no CI env' backend/internal/a.go)"
RB="$( cd "$tree" && env -u GITHUB_OUTPUT bash "$script" --before "$base" \
       --sha "$head" 2>&1 )"; RC=$?
check '10 runs without GITHUB_OUTPUT' "$RC" '0'
has '10 and still states the decision' 'ship=' "$RB"

# ── 12-19. reconcile: production should be SERVING prod's tip ────────────────
# Classifying the push alone is not enough, and this is the case that proves it:
# the PR that installs this gate changes no backend/** file, so a diff-only rule
# would merge, announce "nothing to ship", and leave production running the commit
# from before the referral fix — the exact hole the gate was written to close. So
# the caller also passes what production reports serving today, and an outdated
# production ships regardless of what the push touched.
#
# Precedence, pinned here because each ordering is a decision:
#   migration hard-stop > already-serving > range-unresolvable fail-open >
#   backend-changed > prod-behind > no-backend-change
head="$(fresh 'backend again' backend/internal/a.go)"
run --before "$base" --sha "$head" --serving "$head"
check '12 already serving this commit: no rebuild' "$(ship_of)" 'false'
check '12 exits 0' "$RC" '0'
has '12 says why' 'already-serving' "$OUT"

head_docs="$(fresh 'docs only' docs/guide.md)"
run --before "$base" --sha "$head_docs" --serving "$base"
check '13 prod behind + docs-only push: still ships' "$(ship_of)" 'true'
has '13 names the reason' 'prod-behind' "$OUT"

run --before "$base" --sha "$head_docs" --serving 'unknown'
check '14 unreadable production falls back to the diff' "$(ship_of)" 'false'

run --before "$base" --sha "$head" --serving 'unknown'
check '15 unreadable production still ships backend/**' "$(ship_of)" 'true'

# A migration outranks "we are already serving it": code that is live with an
# unapplied schema is a red job a human must see, never a quiet no-op.
head_mig="$(fresh 'schema again' supabase/migrations/20271900000002_z.sql)"
run --before "$base" --sha "$head_mig" --serving "$head_mig"
check '16 migration outranks already-serving' "$RC" '1'

# The bootstrap case, as an assertion. Linear, because that is what a prod push is:
# a backend commit lands, then a docs commit lands on top of it, and the docs push
# is the first one this gate ever runs under. Production still serves the old build,
# so the docs push ships the backend that has been waiting. A diff-only rule would
# have reported "nothing to ship" here and the referral fix would still be undeployed.
git -C "$tree" reset -q --hard "$base"
pending="$(commit 'backend work production is owed' backend/internal/a.go)"
tip="$(commit 'docs on top' docs/guide.md)"
run --before "$pending" --sha "$tip" --serving "$base"
check '17 a production that is behind ships on a docs-only push' "$(ship_of)" 'true'
has '17 and says it is closing a gap, not reacting to Go' 'prod-behind' "$OUT"

# Deleting a migration is the migration-guard lane's problem, not a reason to stop
# a deploy: the schema is what it is either way, and refusing here would block a
# release for a fact this job cannot act on. The range is paired with
# `--serving = the tip`, which is the answer that route 2 would give if the guard
# stayed quiet, so exit 0 isolates the guard from every other decision (compare
# case 16, which outranks the same serving value and exits 1).
git -C "$tree" reset -q --hard "$base"
with_mig="$(commit 'add a migration' supabase/migrations/20271900000003_w.sql)"
rm -f "$tree/supabase/migrations/20271900000003_w.sql"
git -C "$tree" add -A >/dev/null
git -C "$tree" commit -qm 'delete it again' >/dev/null
deleted="$(git -C "$tree" rev-parse HEAD)"
run --before "$with_mig" --sha "$deleted" --serving "$deleted"
check '18 a deleted migration does not refuse the deploy' "$RC" '0'
has '18 and the decision is the ordinary one' 'already-serving' "$OUT"

# A caller that reads nothing from the build endpoint must not accidentally assert
# "production is behind". `--serving ''` is a failed read, not a fact about the
# world, and the difference is a false rebuild in front of live traffic.
run --before "$base" --sha "$head_docs" --serving ''
check '19 an empty --serving is not read as prod-behind' "$(ship_of)" 'false'

echo
if [ "$failn" -gt 0 ]; then
  echo "FAILED: $failn of $((pass + failn)) assertions"
  exit 1
fi
echo "ok — $pass assertions: ships on backend/**, skips otherwise, refuses migrations, fails open on an unknown range"
