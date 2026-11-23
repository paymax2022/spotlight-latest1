#!/usr/bin/env bash
# scripts/ci/f2-status-probe.sh — can a PROJECT TOKEN decode `railway status --json`?
#
# WHY THIS EXISTS
# F2 is the release wall: every `deploy Staging (…)` leg of every train since
# 2026-11-16 dies 9/9 on `Failed to fetch: error decoding response body`, so
# `smoke Staging` → `migrate production` → `deploy Production` all skip and main
# reaches neither staging nor production on its own. The fault was always read as
# upload-specific, because the string only ever appeared inside a `railway up`.
#
# It does not. Six `workflow_dispatch` runs of `.github/workflows/ops-railway-upload.yml`
# against staging on 2026-11-22 (13:51Z: 45029642480 / 45029655782 / 45029668211;
# 13:59Z: 45030318903 / 45030322482 / 45030326422) died in their own pre-flight,
# 0.3 s after it started, with the same two lines and no archive in sight — job
# 137230172408, step "Confirm the token resolves the intended environment and
# service", whose whole body is:
#
#     railway status --json > /tmp/railway-status.json
#
# Two other measurements narrow what that can mean:
#   * `railway api` with the SAME staging project token on the SAME runner
#     decodes fine and returns a GraphQL error body (`Not Authorized`), proven in
#     CI twice by ci-railway-token-class.yml (runs 45024735432, 45027737590).
#   * The pinned CLI itself is not obviously broken: `npx @railway/cli@5.40.1
#     status --json` run from this repo with the owner's USER token exits 0 and
#     writes 213,691 bytes of parseable JSON.
#
# So the remaining variable is the credential class, and only a runner can say:
# project tokens exist solely as repository secrets (`projectTokenCreate` is
# refused for the owner session). This script is that sentence.
#
# IT ANSWERS IN ONE LINE  (STATUS_VERDICT=…)
#   decoded                → the token reads status fine; the ops lane's refusal
#                            was something else (link state, or a transient), and
#                            F2 stays upload-endpoint-specific after all.
#   decode-refused         → the SAME string as a staging upload, on a plain
#                            read, with a project token. F2 is then a
#                            response-shape problem on this credential class, not
#                            an upload problem, and that is the two-line repro the
#                            support thread has been missing.
#   not-linked             → the lane never linked a project, so its pre-flight
#                            can never pass regardless of the token — a repo bug.
#   token-rejected /
#   unauthorized /
#   token-not-permitted    → the answer is scope, and it decodes.
#   timeout-no-response /
#   empty-body /
#   truncated-json /
#   non-json-body          → distinct transport failures; do not merge them into
#                            "decoded" or into each other.
#
# SAFETY
#   * Read-only by construction: `railway status` changes nothing. There is no
#     mode that deploys, and no state-changing call in this file.
#   * The credential is never printed. `masked=yes` is a claim, so the script
#     proves it: the only lines it emits are label/cli/rc/bytes/verdict, and the
#     body it captures is written to a file under /tmp and never echoed.
#   * The token is NOT piped into argv or into the shell trace; `set +x` is
#     explicit because a runner with `set -x` would print it.
set -uo pipefail
set +x
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

LABEL="${CLASS_LABEL:-anonymous}"
# Match the ops lane exactly. It installs 5.40.1 (see the step "Install the
# pinned Railway CLI" in ops-railway-upload.yml), so a verdict from any other
# version would be about the wrong binary.
VERSION="${PROBE_RAILWAY_VERSION:-5.40.1}"
# `command -v` may be this laptop's 5.71.0 while the runner has the pinned one;
# PROBE_STATUS_CLI lets the workflow force npx and keep the comparison honest.
CLI="${PROBE_STATUS_CLI:-railway}"
TIMEOUT_S="${PROBE_STATUS_TIMEOUT_S:-90}"
OUT=/tmp/f2-status-out.json
ERR=/tmp/f2-status-err.txt
: > "$OUT"; : > "$ERR"

# The token is only ever present in the environment this process was given.
if [[ -z "${RAILWAY_TOKEN:-}" ]]; then
  HAS_TOKEN=no
else
  HAS_TOKEN=yes
fi

# Measured, not requested: `${VERSION}` is what the workflow asked for, and a
# runner whose install step quietly failed would otherwise print the pin anyway.
# `--version` is local and instant, so this cannot be confused with the read.
# Unquoted `$CLI` is deliberate for the npx form (it carries its own arguments),
# which is why the same split appears at the status call below.
if [[ "$CLI" == npx* ]]; then
  # shellcheck disable=SC2086
  CLI_ACTUAL=$(timeout 30 $CLI --version 2>&1 | head -1 | tr -d '\r' || true)
else
  CLI_ACTUAL=$(timeout 30 "$CLI" --version 2>&1 | head -1 | tr -d '\r' || true)
fi

echo "STATUS_CELL_BEGIN label=${LABEL}"
echo "STATUS_CELL credential=masked=yes present=${HAS_TOKEN}"

if [[ "$CLI" == npx* ]]; then
  # shellcheck disable=SC2086
  timeout "$TIMEOUT_S" $CLI status --json > "$OUT" 2> "$ERR"
else
  timeout "$TIMEOUT_S" "$CLI" status --json > "$OUT" 2> "$ERR"
fi
RC=$?

BYTES=$(wc -c < "$OUT" | tr -d '[:space:]')
# The classifier owns the taxonomy, so it can be driven from recorded shapes by
# scripts/ci/test-f2-token-probe.sh instead of only ever running on a runner.
VERDICT=$(python3 scripts/ci/f2-probe-verdict.py status "$RC" "$(cat "$OUT")" "$(cat "$ERR")")
echo "STATUS_CELL cli=${VERSION} rc=${RC} bytes=${BYTES} verdict=${VERDICT}"

# A shape check the verdict cannot make: `decoded` on a body smaller than the
# ~213 KB this workspace's status actually is means the CLI answered something
# that is JSON but is not this project's graph.
if [[ "$VERDICT" == "decoded" ]] && (( BYTES < 1024 )); then
  echo "STATUS_CELL caveat=decoded-but-small bytes=${BYTES}"
fi

# Link state, reported separately because `not-linked` would otherwise be
# indistinguishable from a transport fault on a token that is fine.
if [[ -f ~/.railway/config.json ]]; then
  LINKED=$(python3 - <<'PY' 2>/dev/null || echo unknown
import json, os
try:
    d = json.load(open(os.path.expanduser("~/.railway/config.json")))
    print("projects=%d" % len(d.get("projects") or {}))
except Exception as exc:
    print("unreadable:%s" % type(exc).__name__)
PY
)
else
  LINKED=no-config
fi
echo "STATUS_CELL link_state=${LINKED}"

if [[ "$VERDICT" == "decode-refused" || "$VERDICT" == "non-json-body" || "$VERDICT" == "truncated-json" ]]; then
  # The first line is the CLI's own sentence, which carries no credential.
  echo "STATUS_CELL first=$(head -1 "$ERR" | cut -c1-160)"
fi
echo "STATUS_CELL_END label=${LABEL}"
exit 0
