#!/usr/bin/env bash
# Guard: work must not be stranded in the admin surface we are retiring.
#
# Spotlight has TWO admin consoles. frontend-web/app/admin is a copy of
# frontend-admin (441 pages byte-identical) that was never finished, and
# frontend-admin is the agreed survivor — frontend-web/app/admin gets deleted at
# the end of the migration.
#
# The failure mode this prevents is specific and has already happened: both
# surfaces kept receiving work after the copy stalled, and nine pages diverged.
# Anything added to frontend-web/app/admin from here on is written into a
# directory scheduled for deletion, so it is lost silently at that point — no
# conflict, no error, just gone.
#
# THE RULE
#   A change that ADDS OR MODIFIES anything under frontend-web/app/admin/ must
#   also touch frontend-admin/app/admin/ — i.e. carry the same work to the
#   surface that survives.
#
# Deliberately NOT symmetric: changing only frontend-admin is the normal, desired
# case and always passes. This guard has one job — stop the retiring surface
# accumulating work nobody will migrate.
#
# PURE DELETIONS PASS. Removing files from frontend-web/app/admin IS the
# retirement, so a delete-only change needs no mirror.
#
# Usage (CI passes the PR base):
#   BASE_SHA=<merge-base> HEAD_SHA=<head> bash scripts/ci/check-admin-surface-drift.sh
# Locally, defaults to origin/develop...HEAD.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

RETIRING="frontend-web/app/admin"
SURVIVOR="frontend-admin/app/admin"

BASE_SHA="${BASE_SHA:-$(git merge-base origin/develop HEAD 2>/dev/null || echo '')}"
HEAD_SHA="${HEAD_SHA:-HEAD}"

if [ -z "$BASE_SHA" ]; then
  echo "No base commit to diff against (set BASE_SHA). Guard skipped."
  exit 0
fi

# Names + status, so a delete-only change can be told from an edit.
changed="$(git diff --name-status "$BASE_SHA" "$HEAD_SHA" -- "$RETIRING" "$SURVIVOR" || true)"

if [ -z "$changed" ]; then
  echo "admin surface drift guard passed — no admin pages touched."
  exit 0
fi

# Non-deletion changes to the retiring surface (A=added, M=modified, R=renamed…).
retiring_edits="$(printf '%s\n' "$changed" | awk -v p="$RETIRING/" '$1 !~ /^D/ && $2 ~ "^"p {print $2}')"
survivor_touched="$(printf '%s\n' "$changed" | awk -v p="$SURVIVOR/" '$2 ~ "^"p {print $2}' | head -1)"

if [ -n "$retiring_edits" ] && [ -z "$survivor_touched" ]; then
  printf '%s\n' "$retiring_edits" | while IFS= read -r f; do
    [ -n "$f" ] || continue
    echo "::error file=${f}::Edited in ${RETIRING}, which is being RETIRED, without a matching change in ${SURVIVOR}. This work would be deleted with the surface. Make the change in ${SURVIVOR} (the console that survives), or mirror it to both."
  done
  echo ""
  echo "FAILED: $(printf '%s\n' "$retiring_edits" | grep -c .) file(s) changed only in the retiring admin surface."
  echo "  Retiring: $RETIRING"
  echo "  Survivor: $SURVIVOR   <- put admin work here"
  echo "  Delete-only changes are exempt (that is the retirement itself)."
  exit 1
fi

echo "admin surface drift guard passed — retiring surface not edited in isolation."
