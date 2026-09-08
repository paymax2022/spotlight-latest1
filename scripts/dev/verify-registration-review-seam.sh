#!/usr/bin/env bash
# Exercises review_registration_application end to end on a throwaway
# registration, then removes every row it created. Read-only with respect to
# real data: the temp row uses a contest slug nothing else references.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH=/usr/local/bin:/usr/bin:/bin
DB=$(grep -m1 '^DATABASE_URL=' backend/.env | cut -d= -f2-)

psql "$DB" -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
\set QUIET on
BEGIN;

-- A throwaway application belonging to a real user, on a slug nothing else uses.
CREATE TEMP TABLE t AS
WITH u AS (SELECT id FROM auth.users ORDER BY created_at LIMIT 1),
ins AS (
  INSERT INTO registrations (id, user_id, contest_slug, reference, status, form_data,
                             current_step, completion_percent, role, created_at, updated_at)
  SELECT gen_random_uuid(), u.id, 'zz-seam-verify', 'ZZSEAM-000001-VRFY', 'submitted',
         jsonb_build_object('personal.firstName','Seam','personal.lastName','Verify'),
         'review_submit', 100, 'public_user', NOW(), NOW()
  FROM u
  RETURNING id
)
SELECT id FROM ins;
\set QUIET off

\echo '=== 1. approve -> expect promoted=t and a contestant id ==='
SELECT promoted, removed, contestant_id IS NOT NULL AS got_contestant
FROM review_registration_application((SELECT id FROM t), 'approved', 'seam check', 'admin');

\echo '=== 2. the roster row it created ==='
SELECT c.name, c.status, c.is_active
FROM contestants c WHERE c.registration_id = (SELECT id FROM t);

\echo '=== 3. approve AGAIN -> idempotent, still one roster row ==='
SELECT promoted FROM review_registration_application((SELECT id FROM t), 'approved', 'replay', 'admin');
SELECT count(*) AS roster_rows FROM contestants WHERE registration_id = (SELECT id FROM t);

\echo '=== 4. reject -> expect removed=t and the row deactivated, not deleted ==='
SELECT promoted, removed FROM review_registration_application((SELECT id FROM t), 'rejected', 'seam check', 'admin');
SELECT c.status, c.is_active FROM contestants c WHERE c.registration_id = (SELECT id FROM t);

\echo '=== 5. audit trail: one event per transition ==='
SELECT old_status, new_status, actor_role
FROM registration_status_events WHERE registration_id = (SELECT id FROM t) ORDER BY created_at;

\echo '=== 6. registration final status ==='
SELECT status FROM registrations WHERE id = (SELECT id FROM t);

ROLLBACK;
SQL

echo
echo "=== 7. nothing left behind (expect 0) ==="
psql "$DB" -P pager=off -t -c "select count(*) from registrations where contest_slug='zz-seam-verify';"
