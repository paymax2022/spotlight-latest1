#!/usr/bin/env bash
# Re-apply the promoted Phase 2.5a migration against the live local database.
#
# Why this is a separate piece of evidence rather than a line in the README: 20271099000070 was promoted
# from the estate-d pending draft and then edited twice while the HTTP lane was being written (the purge
# guard's exception now names its real reason, and the sweep/entry functions were already revoked off
# anon). A migration that has only ever been applied once is a migration whose *current text* has never
# been run. Re-applying it proves the file in the repository is idempotent and still executable, which is
# what a reviewer needs to believe when the same file is later applied to staging.
#
# Everything in the file is guarded — ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
# CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS before CREATE TRIGGER, and the pg_trgm block inside a
# DO/EXCEPTION — so the only output expected is NOTICE-level "already exists, skipping" lines and the new
# function body landing. ON_ERROR_STOP=1 makes any real failure exit non-zero instead of scrolling past.
#
# Run:  bash docs/qa/estate-uat-443/live-2026-10-28/03b-reapply-migration.sh
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-$DIR/migration-reapply-phase2.5a.out}"
MIG="$DIR/../../../../supabase/migrations/20271099000070_estate_notifications_archive.sql"

{
  echo "=== re-apply 20271099000070_estate_notifications_archive.sql at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "--- file: $MIG"
  echo "--- sha (first 12): $(sha256sum "$MIG" | cut -c1-12)"
  echo "--- lines: $(wc -l < "$MIG")"
} > "$OUT"

# -i is not cosmetic here: without it `docker exec` closes stdin, psql reads zero statements and exits 0,
# and the transcript would be an empty file claiming a successful apply.
docker exec -i supabase_db_spotlight psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - \
  < "$MIG" >> "$OUT" 2>&1
RC=$?

{
  echo "--- apply exit code: $RC"
  echo "=== guard function text after the re-apply (the reason it names)"
} >> "$OUT"

docker exec -i supabase_db_spotlight psql -U postgres -d postgres -At \
  -c "SELECT pg_get_functiondef('estate_notifications_block_purge()'::regprocedure)" \
  | grep -n "RAISE EXCEPTION" >> "$OUT" 2>&1

{
  echo "=== object inventory the re-apply leaves behind"
} >> "$OUT"
docker exec -i supabase_db_spotlight psql -U postgres -d postgres -c "
SELECT c.relname, c.relkind, COALESCE(i.indisunique,false) AS is_index
  FROM pg_class c LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indexrelid = c.oid
 WHERE c.relname IN ('estate_notifications','estate_notification_retention_policies',
                     'idx_notifications_user_active','idx_notifications_user_archived',
                     'idx_notifications_search_trgm')
 ORDER BY c.relname;" >> "$OUT" 2>&1
docker exec -i supabase_db_spotlight psql -U postgres -d postgres -c "
SELECT tgname, tgtype, tgenabled FROM pg_trigger WHERE tgname='estate_notifications_block_purge_on_delete';
SELECT p.proname, p.prosecdef FROM pg_proc p WHERE p.proname IN
  ('estate_notifications_apply_retention','estate_notifications_retention_for_estate','estate_notifications_block_purge')
 ORDER BY p.proname;" >> "$OUT" 2>&1

echo "wrote $OUT (exit $RC)"
exit $RC
