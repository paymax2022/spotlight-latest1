#!/usr/bin/env bash
# Guard: no two migrations may share a version.
#
# `supabase_migrations.schema_migrations` is keyed on the VERSION ALONE — the
# leading 14-digit timestamp of the filename, not the whole name:
#
#     INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
#
# So two files whose names differ only after the timestamp are, to the CLI, the
# same migration. The second one to apply violates `schema_migrations_pkey` and
# `supabase start` / `supabase db reset` ABORTS PARTWAY THROUGH the chain:
#
#     Applying migration 20261205000000_orch_ledger_conservation_backfill.sql...
#     Applying migration 20261205000000_restaurant_dispute_tip_clawback.sql...
#     ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"
#
# That is not a hypothetical. It has happened twice in two days, because the
# collision is invisible to the author: you pick a free version, your PR sits in
# review, someone else's PR claims that version first, and the break only appears
# on the base branch AFTER your merge. ADR-032 records one bump (`ef99013b`);
# PR #118 records the other. Both were caught by a downstream job replaying the
# chain, long after the merge that caused them.
#
# This guard moves that detection to PR time, where the fix is a rename.
#
# CONVENTION when it fires: the NEWCOMER moves. Whichever migration reached the
# base branch first keeps the version; the PR still in review renumbers to a
# version after the current maximum. Renaming an unapplied migration is free —
# but only while it is unapplied, which is the whole reason to catch it here.
#
# Cheap by construction: pure filename arithmetic, no database, no checkout of
# the base branch. Runs in the hygiene lane alongside the other sub-second gates.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

MIGRATIONS_DIR="supabase/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "No $MIGRATIONS_DIR directory — nothing to check."
  exit 0
fi

# The version is the leading digits, exactly as the Supabase CLI parses it.
# Anything without a leading timestamp is reported separately rather than
# silently grouped under an empty version.
unversioned=""
versions=""

for path in "$MIGRATIONS_DIR"/*.sql; do
  [ -e "$path" ] || continue
  base="$(basename "$path")"
  version="$(printf '%s' "$base" | grep -oE '^[0-9]+' || true)"

  if [ -z "$version" ]; then
    unversioned="${unversioned}${base}"$'\n'
    continue
  fi

  versions="${versions}${version} ${base}"$'\n'
done

fail=0

if [ -n "$unversioned" ]; then
  printf '%s' "$unversioned" | while IFS= read -r base; do
    [ -n "$base" ] || continue
    echo "::error file=${MIGRATIONS_DIR}/${base}::Migration filename does not start with a version timestamp. The Supabase CLI derives the schema_migrations key from the leading digits."
  done
  fail=1
fi

# Duplicate versions, with every colliding filename listed so the annotation
# names the other side of the collision rather than just the number.
dupes="$(printf '%s' "$versions" | awk '{print $1}' | sort | uniq -d || true)"

if [ -n "$dupes" ]; then
  fail=1
  while IFS= read -r version; do
    [ -n "$version" ] || continue
    files="$(printf '%s' "$versions" | awk -v v="$version" '$1 == v {print $2}')"
    joined="$(printf '%s\n' "$files" | paste -sd', ' -)"
    # printf '%s\n' — command substitution stripped the trailing newline, and a
    # final line without one is silently dropped by `read`, which would annotate
    # only the first file of the collision.
    printf '%s\n' "$files" | while IFS= read -r base; do
      [ -n "$base" ] || continue
      echo "::error file=${MIGRATIONS_DIR}/${base}::Migration version ${version} is used by more than one file (${joined}). schema_migrations is keyed on the version alone, so applying the chain fails with schema_migrations_pkey. The migration that reached the base branch LAST must renumber to a version after the current maximum — see scripts/ci/check-migration-versions.sh"
    done
  done <<< "$dupes"
fi

if [ "$fail" -ne 0 ]; then
  echo ""
  if [ -n "$dupes" ]; then
    echo "FAILED: migration versions are not unique."
    echo "Rename the migration that reached the base branch LAST, to a version after the current maximum:"
    printf '%s' "$versions" | awk '{print $1}' | sort | tail -1 | sed 's/^/  current max: /'
  fi
  if [ -n "$unversioned" ]; then
    echo "FAILED: some migration filenames have no leading version timestamp."
    echo "Rename them to <14-digit-timestamp>_<slug>.sql (see the annotations above)."
  fi
  exit 1
fi

total="$(printf '%s' "$versions" | grep -c . || true)"
echo "migration version guard passed — ${total} migrations, all versions unique."
