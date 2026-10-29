-- Phase 2.5a teardown. Scoped by estate name, so it can only ever touch rows this lane created:
--   'UAT Inbox Estate …'        — the Go lane (06-probe-notifications.sh)
--   'UAT Inbox BFF Estate …'    — the BFF lane (08-probe-notifications-bff.sh)
--   'UAT Inbox BFF Other Estate …' — the second estate the same BFF lane seeds to prove the sweep cannot
--                                    reach past the caller's estate (07-seed-notifications-bff.sql)
-- Nothing here matches the 2026-10-26 seed estate or any other session's data.
--
-- Run:
--   docker exec -i supabase_db_spotlight psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - \
--     < docs/qa/estate-uat-443/live-2026-10-28/09-teardown.sql
--
-- Order matters, and the order is the guard's own: a pinned or protected notification cannot be DELETEd at
-- all (that is the point of EST-UAT-0359), so the teardown has to un-pin, move the row out of a protected
-- category and take the estate off hold before it can clear the lane's fixtures. Recording that sequence
-- is part of the evidence — the guard is real enough to block its own test harness.
--
-- The estate_audit_log rows are NOT deleted: they are the record of what the lane did, and a teardown that
-- erases the audit trail is not a teardown. The estates themselves are left as `closed` records, matching
-- the Phase 2.3 and 2.4 lanes rather than vanishing.
BEGIN;

CREATE TEMP TABLE lane_estates ON COMMIT DROP AS
  SELECT id, status FROM estates WHERE name LIKE 'UAT Inbox%';

\echo '=== lanes found (before) ==='
SELECT count(*) AS lane_estates FROM lane_estates;
SELECT count(*) AS lane_notifications FROM estate_notifications
 WHERE estate_id IN (SELECT id FROM lane_estates);

-- 1. stand down the two things the purge guard enforces for these rows.
UPDATE estates SET legal_hold = FALSE WHERE id IN (SELECT id FROM lane_estates);
UPDATE estate_notification_retention_policies SET keep_categories = ARRAY[]::text[]
 WHERE estate_id IN (SELECT id FROM lane_estates);
UPDATE estate_notifications SET pinned = FALSE, category = 'general'
 WHERE estate_id IN (SELECT id FROM lane_estates)
   AND (pinned OR category <> 'general');

-- 2. clear the fixtures.
DELETE FROM estate_notifications WHERE estate_id IN (SELECT id FROM lane_estates);
DELETE FROM estate_notification_retention_policies WHERE estate_id IN (SELECT id FROM lane_estates);

-- 3. the lane's memberships. This is the step that keeps the *other* lanes honest: getResidentContext in
--    the BFF resolves a caller's estate as `.limit(1)` with no order, so a stale membership here would
--    make every later BFF estate assertion for that user ambiguous.
DELETE FROM estate_residents WHERE estate_id IN (SELECT id FROM lane_estates);

-- 4. close what an aborted run left open (a completed run already closed its estate over HTTP; the number
--    of rows this touches is printed below so a hand-closed estate is visible, not silent).
UPDATE estates SET status = 'closed' WHERE id IN (SELECT id FROM lane_estates) AND status <> 'closed';

COMMIT;

\echo '=== lanes after teardown: everything must read 0 except the closed estate rows ==='
SELECT (SELECT count(*) FROM estate_notifications n
         WHERE n.estate_id IN (SELECT id FROM estates WHERE name LIKE 'UAT Inbox%')) AS notifications_left,
       (SELECT count(*) FROM estate_notification_retention_policies p
         WHERE p.estate_id IN (SELECT id FROM estates WHERE name LIKE 'UAT Inbox%')) AS policies_left,
       (SELECT count(*) FROM estate_residents r
         WHERE r.estate_id IN (SELECT id FROM estates WHERE name LIKE 'UAT Inbox%')) AS memberships_left,
       (SELECT count(*) FROM estates WHERE name LIKE 'UAT Inbox%' AND status <> 'closed') AS estates_still_open,
       -- estate_audit_log.subject_id is TEXT while subject rows are addressed by uuid, so the kept-audit
       -- count goes through estate_audit_log.estate_id (uuid). Matching text = uuid here errored on the
       -- first real run of this file and would have hidden whether the audit rows survived.
       (SELECT count(*) FROM estate_audit_log a
         WHERE a.estate_id IN (SELECT id FROM estates WHERE name LIKE 'UAT Inbox%')
           AND a.action LIKE 'NOTIFICATION_RETENTION%') AS retention_audit_rows_kept;

-- Memberships of the long-lived identities, printed rather than asserted. The first real run of this file
-- showed admin at 14, resident at 11 and guard at 5 — memberships accumulated by earlier estate lanes and
-- by other sessions, none of them soft-deleted. So this lane does NOT restore those identities to the
-- single 2026-10-26 seed estate, and any BFF estate assertion made through them resolves to an arbitrary
-- estate (`getResidentContext` uses .limit(1) with no order). That is why this lane's BFF half uses the
-- dedicated inbox-res / inbox-admin identities instead: see the README boundary section. The same finding
-- is why it also created inbox-none: `outsider` turned out to hold five memberships of its own in closed
-- estates, so it could never have proved the 403 "not a resident of any estate" branch. inbox-none must
-- still read 0 here, before and after — nothing in any lane ever inserts it into estate_residents, and a
-- non-zero count would mean a later lane used it as a member.
SELECT pu.email, count(r.id) AS memberships
FROM platform_users pu
LEFT JOIN estate_residents r ON r.user_id = pu.id AND r.deleted_at IS NULL
WHERE pu.email IN ('estate-uat-admin@local.test', 'estate-uat-resident@local.test',
                   'estate-uat-guard@local.test', 'estate-uat-inbox-res@local.test',
                   'estate-uat-inbox-admin@local.test', 'estate-uat-inbox-none@local.test',
                   'estate-uat-outsider@local.test')
GROUP BY pu.email ORDER BY pu.email;

-- 5. undo the reviewer grant (02-grant-reviewer.sql). The three inbox identities keep their auth.users and
--    platform_users rows: they cost nothing, they hold no membership after step 3, and deleting an auth
--    identity from a shared local stack is not this lane's business.
DELETE FROM user_permissions up
 USING permissions p, platform_users pu
 WHERE up.permission_id = p.id AND up.user_id = pu.id
   AND p.slug = 'estate.admin.lifecycle' AND pu.email = 'estate-uat-admin@local.test';

SELECT user_has_permission(pu.id, 'estate.admin.lifecycle') AS lifecycle_granted_after_teardown, pu.email
FROM platform_users pu WHERE pu.email = 'estate-uat-admin@local.test';
