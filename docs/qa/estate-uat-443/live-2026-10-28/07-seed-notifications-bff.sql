-- Phase 2.5a BFF-lane inbox fixtures: the estate, its two members, and the notification rows 08-probe-notifications-bff.sh reads.
--
-- Run:
--   docker exec -i supabase_db_spotlight psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -v stamp=$STAMP -v admin=$INBOX_ADMIN_UID -v res=$INBOX_RES_UID -v other=$OUTSIDER_UID -f - \
--     < docs/qa/estate-uat-443/live-2026-10-28/07-seed-notifications-bff.sql
--
-- Why the estate is created here instead of over HTTP, as the Go lane does: the BFF never takes an estate id
-- from the caller. Every route resolves it from the caller's own membership (src/server/estate/resident.ts),
-- so there is no request that could create the estate this lane needs to be *in*. The 2026-10-26 BFF lane
-- seeded its estate the same way for the same reason.
--
-- Why dedicated identities: getResidentContext resolves a caller's estate as
-- `.eq('user_id', …).limit(1)` with no ORDER BY. The three long-lived UAT identities have picked up 14, 11 and
-- 5 memberships from earlier estate lanes, so an assertion made through them would test whichever row Postgres
-- happened to return first. inbox-res and inbox-admin belong to this lane alone, and the teardown removes their
-- memberships so the next BFF lane starts with the same guarantee.
--
-- The estate is inserted as `pending`, not `active`: the BFF's lifecycle mirror (assertEstateWritable, called
-- with forWrite) is part of what this lane tests, and it can only be tested against an estate that is not
-- active. 08-probe-notifications-bff.sh proves the 423s and then flips the row to active in SQL — flipping the
-- status directly is not testing the lifecycle route (the Go lane did that over HTTP in section 2), it is
-- moving the fixture on so the rest of this lane can run.
BEGIN;

INSERT INTO estates (name, admin_id, status)
SELECT 'UAT Inbox BFF Estate ' || :'stamp', :'admin'::uuid, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM estates WHERE name = 'UAT Inbox BFF Estate ' || :'stamp');

-- Bound the rest of the script to that one estate, so a re-run over an existing stamp can never reach a
-- different estate's rows. Deliberately not `ON COMMIT DROP`: the summary SELECT at the foot of this file runs
-- after the COMMIT, and a dropped temp table would make the transcript's own fixture counts unreadable.
CREATE TEMP TABLE lane AS
  SELECT id FROM estates WHERE name = 'UAT Inbox BFF Estate ' || :'stamp';

INSERT INTO estate_residents (estate_id, user_id, unit, role)
SELECT id, :'admin'::uuid, 'UAT-25b-001', 'estate_admin' FROM lane
ON CONFLICT (estate_id, user_id) DO UPDATE SET role = 'estate_admin', unit = EXCLUDED.unit;

INSERT INTO estate_residents (estate_id, user_id, unit, role)
SELECT id, :'res'::uuid, 'UAT-25b-101', 'resident' FROM lane
ON CONFLICT (estate_id, user_id) DO UPDATE SET role = 'resident', unit = EXCLUDED.unit;

-- Every title carries `UAT25b ` and a two-digit label, so the probe looks rows up by exact title and the
-- teardown can prove it only deletes what this file inserted. The shape deliberately mirrors the Go lane's
-- 04-seed-notifications.sql — same states, fewer rows — so a difference in the two answers is a difference
-- between the surfaces, not between their fixtures.
--
-- What each label exists to prove on this surface:
--   01 pinned + old + read           -> sorts first on every page, a sweep leaves it alone
--   02 old + read + unpinned         -> the archive-eligible case
--   03 old + read, security          -> protected category: not archived even when eligible
--   05 old + unread                  -> a sweep never archives what nobody has read
--   06 body carries a rare token     -> search reaches body, not only title. The token is in the BODY only:
--                                        the probe asserts the returned row's title does not contain it, and
--                                        a title that held it made that assertion unprovable.
--   07 mid age + deep_link           -> the link and the read stamp survive the archive round trip
--   08 newest row, unread            -> the read-stamp test and the newest-first anchor
--   11 archived, plain               -> the purge-eligible case
--   12 archived + pinned             -> the guard refuses it and the sweep never asks
--   13 archived + protected          -> the same refusal for a category, not a row flag
--   14 archived + unread             -> read-all does not reach into the archive half
--   21 the admin's own copy           -> a resident's actions do not touch it; the estate-wide sweep does
--   31 a different estate            -> the BFF sweep is scoped to the caller's estate and stops there
--   bulk 01..60                      -> the inbox is bigger than the old flat 100-row answer, and paging shows it
WITH f(label, category, title, body, deep_link, age_days, age_min, is_read, is_pinned, archived_days) AS (
    VALUES
      ('01', 'general',     'UAT25b 01 pinned twenty',       'Pinned copy of the gate roster dispute.',                NULL,                    200,  0, TRUE,  TRUE,  NULL),
      ('02', 'general',     'UAT25b 02 old general read',    'Ordinary notice, past every horizon, already read.',      NULL,                    200, 30, TRUE,  FALSE, NULL),
      ('03', 'security',    'UAT25b 03 old security read',   'A guard post verdict, two hundred days old.',            NULL,                    200, 31, TRUE,  FALSE, NULL),
      ('05', 'general',     'UAT25b 05 old general unread',  'Nobody has opened it; a schedule must not hide it.',       NULL,                    200, 33, FALSE, FALSE, NULL),
      ('06', 'payment',     'UAT25b 06 body-only token',     'Kairos generator deposit for the meeting hall.',          NULL,                      3, 10, FALSE, FALSE, NULL),
      ('07', 'maintenance', 'UAT25b 07 mid maintenance',     'Lift service window.',                                    '/estate/maintenance/77',    5,  0, TRUE,  FALSE, NULL),
      ('08', 'general',     'UAT25b 08 newest general',      'The newest row in the inbox.',                            NULL,                      1,  0, FALSE, FALSE, NULL),
      ('11', 'general',     'UAT25b 11 archived old general','Already out of the inbox, already past the horizon.',      NULL,                    200, 40, TRUE,  FALSE, 100),
      ('12', 'general',     'UAT25b 12 archived pinned',     'Archived and pinned: the guard has to refuse its DELETE.', NULL,                    200, 41, TRUE,  TRUE,  100),
      ('13', 'security',    'UAT25b 13 archived security',   'Archived but protected by category.',                      NULL,                    200, 42, TRUE,  FALSE, 100),
      ('14', 'general',     'UAT25b 14 archived unread',     'Archived without ever being read.',                        NULL,                    200, 43, FALSE, FALSE, 100)
)
INSERT INTO estate_notifications (estate_id, user_id, category, title, body, deep_link, read_at, pinned, created_at, archived_at)
SELECT lane.id, :'res'::uuid, f.category, f.title, f.body, f.deep_link,
       CASE WHEN f.is_read THEN NOW() - make_interval(days => f.age_days, mins => f.age_min) END,
       f.is_pinned,
       NOW() - make_interval(days => f.age_days, mins => f.age_min),
       CASE WHEN f.archived_days IS NULL THEN NULL ELSE NOW() - make_interval(days => f.archived_days) END
FROM f, lane
WHERE NOT EXISTS (SELECT 1 FROM estate_notifications n
                  WHERE n.estate_id = lane.id AND n.title = f.title);

-- The estate admin's own copy, in the same estate: what the resident does to their row must not touch it, and
-- what the admin's pin-on-behalf does is a deliberate act on somebody else's row.
INSERT INTO estate_notifications (estate_id, user_id, category, title, body, read_at, pinned, created_at)
SELECT lane.id, :'admin'::uuid, 'general', 'UAT25b 21 admin copy', 'The same event, the administrator''s inbox.',
       NOW() - make_interval(days => 200, mins => 45), FALSE, NOW() - make_interval(days => 200, mins => 45)
FROM lane
WHERE NOT EXISTS (SELECT 1 FROM estate_notifications n
                  WHERE n.estate_id = lane.id AND n.title = 'UAT25b 21 admin copy');

-- Sixty same-category rows a minute apart: the BFF feed used to answer a flat 100 newest with no total, and
-- the pre-Phase-2.5a mobile list could not see past them. More than the 50-row default page, fewer than the
-- 200-row ceiling, so paging and the `total` are both observable without a large table.
INSERT INTO estate_notifications (estate_id, user_id, category, title, body, read_at, pinned, created_at)
SELECT lane.id, :'res'::uuid, 'announcement',
       'UAT25b bulk ' || lpad(g::text, 2, '0'),
       'Bulk fixture ' || g || ' for the paging envelope.',
       NULL, FALSE,
       NOW() - make_interval(days => 2) + make_interval(mins => g)
FROM generate_series(1, 60) AS g, lane
WHERE NOT EXISTS (SELECT 1 FROM estate_notifications n
                  WHERE n.estate_id = lane.id AND n.title = 'UAT25b bulk ' || lpad(g::text, 2, '0'));

-- A second estate the lane's caller does NOT belong to, holding one fully archive-and-purge-eligible row.
-- The BFF derives the estate from the caller's membership, so `POST /retention/run` can only ever be asked
-- to sweep one estate — this estate is what proves the sweep stayed inside it, rather than the assertion
-- resting on "no other estate happened to have anything eligible". Its recipient is the outsider identity,
-- which holds no membership anywhere in the estate module.
INSERT INTO estates (name, admin_id, status)
SELECT 'UAT Inbox BFF Other Estate ' || :'stamp', :'other'::uuid, 'active'
WHERE NOT EXISTS (SELECT 1 FROM estates WHERE name = 'UAT Inbox BFF Other Estate ' || :'stamp');

CREATE TEMP TABLE other_lane AS
  SELECT id FROM estates WHERE name = 'UAT Inbox BFF Other Estate ' || :'stamp';

INSERT INTO estate_notifications (estate_id, user_id, category, title, body, read_at, pinned, created_at)
SELECT o.id, :'other'::uuid, 'general', 'UAT25b 31 other estate',
       'Eligible on every rule, and none of this lane''s sweeps may reach it.',
       NOW() - make_interval(days => 200, mins => 50), FALSE, NOW() - make_interval(days => 200, mins => 50)
FROM other_lane o
WHERE NOT EXISTS (SELECT 1 FROM estate_notifications n
                  WHERE n.estate_id = o.id AND n.title = 'UAT25b 31 other estate');

COMMIT;

-- What the lane is now asserting against. Printed, not assumed: 08 reads its counts from the database, and
-- this gives the transcript a fixture shape a reviewer can check the counts against.
SELECT (SELECT count(*) FROM estate_notifications n JOIN lane l ON l.id = n.estate_id) AS lane_rows,
       (SELECT count(*) FROM estate_notifications n JOIN lane l ON l.id = n.estate_id
         WHERE n.user_id = :'res'::uuid AND n.archived_at IS NULL) AS resident_active,
       (SELECT count(*) FROM estate_notifications n JOIN lane l ON l.id = n.estate_id
         WHERE n.user_id = :'res'::uuid AND n.archived_at IS NOT NULL) AS resident_archived,
       (SELECT count(*) FROM estate_notifications n JOIN lane l ON l.id = n.estate_id
         WHERE n.user_id = :'res'::uuid AND n.archived_at IS NULL AND n.read_at IS NULL) AS resident_unread_active,
       (SELECT count(*) FROM estate_notifications n JOIN lane l ON l.id = n.estate_id
         WHERE n.pinned) AS pinned_rows,
       (SELECT status FROM estates e JOIN lane l ON l.id = e.id) AS estate_status,
       (SELECT count(*) FROM estate_notifications n JOIN other_lane o ON o.id = n.estate_id) AS other_estate_rows;
