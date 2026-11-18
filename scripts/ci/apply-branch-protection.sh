#!/usr/bin/env bash
# Apply branch protection, taking the required status checks from
# .github/required-checks.txt for the branch being protected, so the lists have
# exactly one home and one parser.
#
#   GITHUB_TOKEN=<admin token> scripts/ci/apply-branch-protection.sh main
#
# The set differs per branch (@all + @<branch> sections), so the branch argument now
# selects it. A branch with no section is a hard error rather than an empty payload —
# PUTting zero contexts would silently un-gate it, which is the AUD-TEST-003 failure
# this script exists to prevent. As of 2026-11-17 only `main` has a section: ci.yml
# dropped develop/staging/prod from its triggers, so those contexts can never report
# there and develop's stale nine-context protection needs clearing by hand first.
#
# Deliberate choices, each of which you would otherwise discover the hard way:
#
#   enforce_admins = false
#     Required status checks block DIRECT pushes to the protected branch, and
#     the checks only run after a push lands — so with admins enforced, the
#     standing "rebase, one fast-forward push to develop" workflow becomes
#     impossible and every change would need a PR. Admins keep the bypass; the
#     gate still applies to PRs and to everyone else.
#
#   strict = false
#     "Require branches to be up to date before merging" forces a rebase every
#     time the base moves. develop moves several times an hour here, so strict
#     would mean a PR is never mergeable without a race.
#
#   required_pull_request_reviews = null
#     Not requested, and on this repo it would block the owner's own workflow.
#     Add it deliberately, not as a side effect of wanting a status gate.
set -euo pipefail

# No default branch: the required set is per-branch now, so a default would either PUT
# the wrong list or resolve to nothing. Saying so beats guessing.
BRANCH="${1:?usage: apply-branch-protection.sh <protected branch>, e.g. main}"
REPO="${REPO:-paymax2022/spotlight-latest1}"
TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

CONTEXTS_FILE="$ROOT/.github/required-checks.txt"
PARSER="$ROOT/scripts/ci/required-checks.py"
[[ -f "$CONTEXTS_FILE" ]] || { echo "error: missing $CONTEXTS_FILE" >&2; exit 1; }
[[ -f "$PARSER" ]] || { echo "error: missing $PARSER" >&2; exit 1; }

# Resolve this branch's set (@all + @<branch>) with the SAME parser the drift test and
# release-gates.py use — a private parse here is how the deploy gate and branch
# protection could disagree about one file. This runs before the token guard so an
# ungated branch or a malformed file explains itself instead of reporting a missing
# token, and it writes nothing: the only network call is the curl below.
CONTEXTS_JSON="$(python3 "$PARSER" --branch "$BRANCH" --file "$CONTEXTS_FILE" --json)" || exit 1

BODY="$(CONTEXTS_JSON="$CONTEXTS_JSON" python3 - <<'PY'
import json, os
contexts = json.loads(os.environ["CONTEXTS_JSON"])["contexts"]
if not contexts:
    raise SystemExit("error: no contexts listed")
print(json.dumps({
    "required_status_checks": {"strict": False, "contexts": contexts},
    "enforce_admins": False,
    "required_pull_request_reviews": None,
    "restrictions": None,
    "allow_force_pushes": False,
    "allow_deletions": False,
}))
PY
)"

if [[ -z "$TOKEN" ]]; then
  echo "error: set GITHUB_TOKEN (needs admin on $REPO)" >&2
  exit 1
fi

echo "Applying protection to $REPO@$BRANCH with $(python3 -c "
import json,sys; print(len(json.loads(sys.argv[1])['required_status_checks']['contexts']))" "$BODY") required checks:"
printf '%s\n' "$CONTEXTS_JSON" | python3 -c 'import json,sys
for c in json.load(sys.stdin)["contexts"]:
    print("  -", c)'

curl -sS -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/branches/$BRANCH/protection" \
  -d "$BODY" \
  -o /tmp/protection-result.json -w $'\nHTTP %{http_code}\n'

python3 - <<'PY'
import json
d = json.load(open("/tmp/protection-result.json"))
if "message" in d:
    raise SystemExit(f"  FAILED: {d['message']}")
rsc = d.get("required_status_checks", {})
print("  strict:", rsc.get("strict"))
print("  enforce_admins:", d.get("enforce_admins", {}).get("enabled"))
print("  contexts:", len(rsc.get("contexts", [])))
PY
