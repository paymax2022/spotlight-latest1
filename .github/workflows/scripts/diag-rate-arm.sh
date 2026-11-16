#!/usr/bin/env bash
# diag-rate-arm.sh <serial|burst|serial2> — can staging take three uploads, and
# only three uploads that are not bunched together?
#
# The tree uploaded lives at $GITHUB_WORKSPACE/tree (a second checkout pinned to
# the commit the refused legs used), so archive content is held constant.
#
#   serial  — three staging uploads, one after another, 20 s apart
#   burst   — three staging uploads launched at the same instant (`&` + wait)
#   serial2 — a repeat of serial, so a burst failure cannot be blamed on the clock
#
# The argv is the refused call copied from run 43909191817's log. Only --message
# varies, because Railway keys the deployment rows on it and three identical
# messages would make the accept/refusal count ambiguous.
#
# Acceptance test: the CLI prints `Indexing...` once the upload-initiate request
# answered with JSON. The refusal prints
#   Failed to fetch: error decoding response body
#     0: error decoding response body
#     1: expected value at line 1 column 1
# and exits 1 within ~0.7 s, before anything is packed.
set -uo pipefail

MODE="${1:?usage: diag-rate-arm.sh <serial|burst|serial2>}"
TREE="$GITHUB_WORKSPACE/tree"
[ -d "$TREE" ] || { echo "::error::no tree checkout at $TREE"; exit 1; }
cd "$TREE" || exit 1
FULL="$(git rev-parse HEAD)"

if [ -z "${RAILWAY_TOKEN:-}" ]; then echo "::error::RAILWAY_TOKEN is empty"; exit 1; fi
echo "::add-mask::$RAILWAY_TOKEN"

redact() {
  sed -E 's#eyJ[A-Za-z0-9._-]{10,}#<jwt-redacted>#g;
          s#(rlwy_[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+#\1<redacted>#g;
          s#([Aa]uthorization[^:]*:).*#\1 <header-redacted>#g'
}

one() { # one <tag> <outfile>
  local tag="$1" out="$2" start rc
  start="$(date -u +%H:%M:%S)"
  railway up backend --path-as-root --no-gitignore \
    --service backend --environment staging \
    --project "$RAILWAY_PROJECT" \
    --detach --message "$FULL-$tag" > "$out" 2>&1
  rc=$?
  printf '%s|%s|%s\n' "$tag" "$start" "$rc" >> /tmp/results.tsv
  echo "=== $tag exit=$rc at $start :: $(redact < "$out" | head -c 400 | tr '\n' ' ')"
  return "$rc"
}

rm -f /tmp/results.tsv
: > /tmp/results.tsv
echo "### mode $MODE — token length (never value): ${#RAILWAY_TOKEN}, tree $FULL"

case "$MODE" in
  serial|serial2)
    ok=0
    for i in 1 2 3; do
      if one "$MODE-i$i" "/tmp/$MODE-$i.log"; then ok=$((ok + 1)); fi
      [ "$i" -lt 3 ] && sleep 20
    done
    echo "### $MODE accepted=$ok/3 (spaced 20s)"
    ;;
  burst)
    # Same instant, three processes — the shape release.yml's matrices produce when
    # deploy-development and deploy-staging both fire without max-parallel.
    for i in 1 2 3; do
      one "burst-i$i" "/tmp/burst-$i.log" &
    done
    wait
    ok="$(awk -F'|' '$3==0' /tmp/results.tsv | wc -l | tr -d ' ')"
    echo "### burst accepted=$ok/3 (launched simultaneously)"
    ;;
  *) echo "::error::unknown mode $MODE"; exit 64 ;;
esac

echo "| mode | spacing | accepted | refused |" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
n_total="$(wc -l < /tmp/results.tsv | tr -d ' ')"
n_ok="$(awk -F'|' '$3==0' /tmp/results.tsv | wc -l | tr -d ' ')"
n_bad=$((n_total - n_ok))
space=20; [ "$MODE" = burst ] && space=0
echo "| $MODE | ${space}s | $n_ok | $n_bad |" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
echo "--- per-call rows (tag|utc|exit) ---"
sort /tmp/results.tsv
[ "$n_bad" -eq 0 ]
