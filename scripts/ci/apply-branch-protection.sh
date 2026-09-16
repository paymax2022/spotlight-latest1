#!/usr/bin/env bash
# Apply branch protection, taking the required status checks from
# .github/required-checks.txt so the list has exactly one home.
#
#   GITHUB_TOKEN=<admin token> scripts/ci/apply-branch-protection.sh develop
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

BRANCH="${1:-develop}"
REPO="${REPO:-paymax2022/spotlight-latest1}"
TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ -z "$TOKEN" ]]; then
  echo "error: set GITHUB_TOKEN (needs admin on $REPO)" >&2
  exit 1
fi

CONTEXTS_FILE="$ROOT/.github/required-checks.txt"
[[ -f "$CONTEXTS_FILE" ]] || { echo "error: missing $CONTEXTS_FILE" >&2; exit 1; }

BODY="$(CONTEXTS_FILE="$CONTEXTS_FILE" python3 - <<'PY'
import json, os
contexts = [
    line.strip()
    for line in open(os.environ["CONTEXTS_FILE"])
    if line.strip() and not line.strip().startswith("#")
]
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

echo "Applying protection to $REPO@$BRANCH with $(python3 -c "
import json,sys; print(len(json.loads(sys.argv[1])['required_status_checks']['contexts']))" "$BODY") required checks:"
grep -v '^\s*#' "$CONTEXTS_FILE" | grep -v '^\s*$' | sed 's/^/  - /'

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
