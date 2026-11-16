#!/usr/bin/env bash
# diag-env-arm.sh <ARM> — make three staging `railway up` calls and judge each one.
#
# Lives on the throwaway diag branch; the TREE it uploads is a second checkout at
# $GITHUB_WORKSPACE/tree pinned to the commit the refused legs used, so archive
# content is held constant across the arms too.
#
# The argv is copied from run 43909191817's log:
#   railway up backend --path-as-root --no-gitignore --service backend
#     --environment staging --project <p> --detach --message <40-hex>
# Only --message varies per call, because Railway keys deployments on it and three
# identical rows would make the accept/refusal count ambiguous.
#
# Acceptance test: the CLI prints `Indexing...` once the upload-initiate request
# answered with JSON and it has the archive going. The refusal prints
#   Failed to fetch: error decoding response body
#     0: error decoding response body
#     1: expected value at line 1 column 1
# and exits 1 inside a second, before anything is packed.
set -uo pipefail

ARM="${1:?usage: diag-env-arm.sh <A|B|C>}"
TREE="$GITHUB_WORKSPACE/tree"
[ -d "$TREE" ] || { echo "::error::no tree checkout at $TREE"; exit 1; }
cd "$TREE" || exit 1

redact() {
  sed -E 's#eyJ[A-Za-z0-9._-]{10,}#<jwt-redacted>#g;
          s#(rlwy_[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+#\1<redacted>#g;
          s#([Aa]uthorization[^:]*:).*#\1 <header-redacted>#g'
}

FULL="$(git rev-parse HEAD)"
if [ -z "${RAILWAY_TOKEN:-}" ]; then echo "::error::RAILWAY_TOKEN is empty"; exit 1; fi
echo "::add-mask::$RAILWAY_TOKEN"
echo "### arm $ARM — token length (never value): ${#RAILWAY_TOKEN}, tree $FULL"

accepted=0
refused=0
for i in 1 2 3; do
  # A distinct message per call, still 40 chars of hex-ish identity so it reads
  # like the release chain's: <sha>-<arm><i>.
  MSG="$FULL-$ARM$i"
  start="$(date -u +%H:%M:%S)"
  out="$(railway up backend --path-as-root --no-gitignore \
          --service backend --environment staging \
          --project "$RAILWAY_PROJECT" \
          --detach --message "$MSG" 2>&1)"
  rc=$?
  brief="$(redact <<<"$out" | head -c 600 | tr '\n' ' ')"
  if [ "$rc" -eq 0 ]; then
    accepted=$((accepted + 1))
    echo "=== $ARM/$i ACCEPTED exit=0 at $start :: $brief"
  else
    refused=$((refused + 1))
    echo "=== $ARM/$i REFUSED exit=$rc at $start :: $brief"
    # Replay once with --verbose so the log carries whatever the CLI can say about
    # the response it could not decode. Same command, one extra flag.
    vout="$(railway up backend --path-as-root --no-gitignore \
             --service backend --environment staging \
             --project "$RAILWAY_PROJECT" \
             --detach --verbose --message "$MSG-v" 2>&1)"
    vrc=$?
    echo "--- $ARM/$i verbose replay exit=$vrc ---"
    redact <<<"$vout" | head -60
  fi
  sleep 6
done

echo "### arm $ARM summary: accepted=$accepted refused=$refused"
{
  echo "| arm | accepted | refused |"
  echo "|---|---|---|"
  echo "| $ARM | $accepted | $refused |"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

[ "$refused" -eq 0 ]
