#!/usr/bin/env bash
# prod-ship-scope.sh — decide whether a push to `prod` puts a new backend image in
# front of production. Prints the decision, writes `ship=true|false` to
# GITHUB_OUTPUT, and exits 1 when the push must NOT ship automatically.
#
# This is the answer to "why isn't this automatic?" on the prod lineage. That
# lineage never had an automatic deploy at all: ci.yml's three deploy jobs each
# require `github.event_name == 'workflow_dispatch'` plus a typed `DEPLOY`, which
# is how shipping production became a hand-run `railway up backend` that nobody
# audits and that gets forgotten (the referral-code fix sat merged on prod for a
# day with production still serving the previous build). Making it automatic is
# only safe once the push says WHY it should ship, in a form a test can pin —
# hence this file and scripts/ci/test-prod-ship-scope.sh.
#
# Usage:
#   prod-ship-scope.sh --before <sha> --sha <sha> [--serving <sha|unknown>]
#
#   --before   the commit the branch was at before this push (${{ github.event.before }})
#   --sha      the commit being shipped (${{ github.sha }})
#   --serving  the commit production's backend reports right now, read from
#              /api/v1/public/build by the caller, or the literal 'unknown' when it
#              could not be read. Optional: without it the decision is the push
#              classification alone. An empty value means the same as 'unknown'.
#
# THE INVARIANT, which is not "ship when Go changed"
# Production should be SERVING the tip of `prod`. A diff-only rule cannot express
# that, and would have failed the very change that introduces it: the PR that
# installs this gate touches no backend/** file, so it would merge, report "nothing
# to ship", and leave production running the build from before the referral-code fix
# — the hole this file exists to close. So the answer is `did the image change` OR
# `is production behind`, and the reasons are kept separate in the output because
# they are different facts about the world.
#
# Decisions, in precedence order (each ordering is a decision — see the test):
#   exit 1      supabase/migrations/** is in the push — see THE MIGRATION RULE.
#               Outranks every other answer, including already-serving: live code
#               with an unapplied schema is a red a human must see, not a no-op.
#   ship=false  --serving == --sha — production already serves this commit, so a
#               rebuild would be a restart for identical bytes. reason=already-serving
#   ship=true   unresolvable --range and not already serving. reason=range-unresolvable
#   ship=true   backend/** changed. reason=backend-changed
#   ship=true   production serves something else. reason=prod-behind
#   ship=false  nothing the image contains changed and production is not behind
#
# WHY `backend/` AND ONLY `backend/`
# The production Railway backend is written by `railway up backend --path-as-root`
# (see scripts/ci/railway-deploy.sh's THE UPLOAD RULE), which makes the archive
# root the `backend/` folder, and backend/Dockerfile:11 is `COPY . .` against that
# root. So the image consumes exactly `backend/**` and nothing else — no
# `contracts/`, no `supabase/`, no Makefile. That makes the predicate both simple
# and complete, and it is the reason a workflow-only or admin-console-only push
# can skip a 25 MB rebuild without any chance of shipping a stale artifact: there
# is no such thing as a stale artifact here, only an unchanged one. If the
# Dockerfile ever grows a COPY from outside `backend/`, add that path to the
# pattern below and extend the test — do not deploy-on-everything instead.
#
# THE MIGRATION RULE
# A push that carries a migration is a code-plus-schema release, and this lineage
# has no automatic production apply: release.yml's migrate-production job is a
# main-lineage thing, and prod's database moves only through the manual ops lanes.
# Deploying code that expects a table the production database does not have is the
# worse of the two failure modes, so this script refuses, and the deploy job never
# runs. It refuses rather than skipping because a skip looks like "nothing to do"
# and a refused release is a red job that says what to do about it.

set -uo pipefail

usage() {
  printf 'usage: %s --before <sha> --sha <sha>\n' "$0" >&2
}

before=''
sha=''
serving='unknown'
while [ $# -gt 0 ]; do
  case "$1" in
    --before) [ $# -ge 2 ] || { usage; exit 2; }; before="$2"; shift 2 ;;
    --sha)    [ $# -ge 2 ] || { usage; exit 2; }; sha="$2"; shift 2 ;;
    --serving) [ $# -ge 2 ] || { usage; exit 2; }; serving="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

if [ -z "$sha" ] || [ -z "$before" ]; then
  usage
  exit 2
fi

# An empty --serving means the caller could not read the build endpoint, which is
# the same fact as 'unknown'. Left literal, the empty string would reach route 4
# and read as "production is serving something else" — a failed probe turning into
# a container roll in front of live traffic.
if [ -z "$serving" ]; then serving='unknown'; fi

ZERO=0000000000000000000000000000000000000000

emit() { # emit <key> <value>
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
  fi
  # Also on stdout: an operator running this by hand, and case 10 of the test,
  # both read the decision from the log rather than from a runner-only file.
  printf '%s=%s\n' "$1" "$2"
}

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    # %b, not %s: the call sites write \n for a real line break, and %s would put
    # a literal backslash-n in the job summary.
    printf '%b\n' "$*" >> "$GITHUB_STEP_SUMMARY"
  fi
}

# The commit we are being asked to ship has to exist locally or nothing below
# means anything. Unlike --before, an unresolvable --sha is never a reason to ship.
if ! git rev-parse --verify "${sha}^{commit}" >/dev/null 2>&1; then
  echo "::error::prod-ship-scope: --sha '$sha' is not a commit in this checkout"
  exit 1
fi

# ── 1. the migration hard-stop (needs a resolvable range, so resolve it first) ──
FILES=''
range_ok=1
if [ "$before" = "$ZERO" ] || ! git rev-parse --verify "${before}^{commit}" >/dev/null 2>&1; then
  range_ok=0
else
  # `git diff a b` compares trees, not history, so a rebased or fast-forwarded prod
  # branch still classifies correctly here. Deliberately no merge-base and no
  # `a...b`: three-dot would re-add ancestry semantics this file does not want.
  FILES="$(git diff --name-only "$before" "$sha")"
  # The migration guard looks at ADDED and MODIFIED files only, unlike the backend
  # test below which reads every name. Deleting a migration from the tree is not
  # "a schema change is in flight" — the file was already applied or never was, and
  # the additive-only guard lane (migration-guard, scripts/ci/check-migration-versions.sh)
  # owns that problem. Refusing a deploy for a deletion would block it for a reason
  # this job cannot fix, which is how a gate earns being switched off.
  MIGRATIONS="$(git diff --name-only --diff-filter=AM "$before" "$sha")"
  if printf '%s\n' "$MIGRATIONS" | grep -qE '^supabase/migrations/'; then
    echo "::error::prod-ship-scope: this push carries supabase/migrations/**, and the production database is NOT auto-applied on the prod lineage. Code that expects an unapplied schema will not deploy. Apply the migration to production first (ops-db-push.yml, environment Production), then re-run the 'deploy Production backend (automatic)' job on this run to ship."
    summary "### production ship scope\n\n- **REFUSED**: this push contains a database migration and production's schema is a manual apply on this lineage."
    # No ship= line: a refused release must not leave a value the deploy job could
    # read as permission.
    exit 1
  fi
fi

# ── 2. already serving this exact commit ──────────────────────────────────────
if [ "$serving" = "$sha" ]; then
  echo "prod-ship-scope: production's backend already reports $sha, so this push would rebuild identical bytes and restart live traffic. Nothing to ship."
  emit ship false
  emit reason 'already-serving'
  exit 0
fi

if [ "$range_ok" = '0' ]; then
  # A branch's first push, a force-push, or a checkout that does not hold the old
  # tip (the `changes` job checks out with fetch-depth: 0 for exactly this reason —
  # keep this job's checkout the same or this branch becomes the common path).
  # Failing open ships what CI just greened; failing closed would stop production
  # receiving releases the moment branch history is rewritten, and would look like
  # success while doing it. The migration guard above could not run without a
  # range, which is the cost of this choice and the reason it stays announced.
  echo "::warning::prod-ship-scope: could not resolve --before ($before); shipping whatever prod's CI just greened"
  summary "### production ship scope\n\n- could not establish the push range — **failing open**, ship the backend"
  emit ship true
  emit reason 'range-unresolvable'
  exit 0
fi

# ── 3. the image itself changed ───────────────────────────────────────────────
if printf '%s\n' "$FILES" | grep -qE '^backend/'; then
  echo "prod-ship-scope: $(printf '%s\n' "$FILES" | grep -cE '^backend/') backend path(s) changed in $before..$sha — the production backend image is stale."
  printf '%s\n' "$FILES" | grep -E '^backend/' | sed 's/^/    /'
  emit ship true
  emit reason 'backend-changed'
  exit 0
fi

# ── 4. the image is unchanged but production is behind ───────────────────────
# This is the repair branch, and the one that makes the gate a reconciliation
# rather than an event handler: a manual upload someone forgot, a deploy that
# failed and was never re-run, or (as above) the merge that installs this file all
# land here. An empty range arrives too — prod moved without a CI run of its own.
if [ "$serving" != 'unknown' ]; then
  echo "prod-ship-scope: no backend/** file changed, but production serves $serving and prod's tip is $sha — shipping what production is owed."
  emit ship true
  emit reason 'prod-behind'
  exit 0
fi

# ── 5. nothing to do ──────────────────────────────────────────────────────────
if [ -z "$FILES" ]; then
  echo "prod-ship-scope: $before..$sha changes no files, and production's build endpoint is unreadable so 'behind' cannot be established. Shipping nothing."
else
  echo "prod-ship-scope: no backend/** file changed in $before..$sha, so the image production would rebuild is identical, and production is not known to be behind. Skipping the deploy."
  printf '%s\n' "$FILES" | sed 's/^/    /'
fi
emit ship false
emit reason 'no-backend-change'
