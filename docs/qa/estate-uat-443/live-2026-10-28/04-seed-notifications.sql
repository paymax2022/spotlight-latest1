-- Phase 2.5a Go-lane inbox fixtures. Run through:
--
--   docker exec -i supabase_db_spotlight psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -v estate=$ESTATE -v res=$RESIDENT_UID -v guard=$GUARD_UID -f - \
--     < docs/qa/estate-uat-443/live-2026-10-28/04-seed-notifications.sql
--
-- Why a direct insert rather than the notify() path: notify() applies member delivery preferences and a
-- dedupe window, both of which silently drop exactly the rows this lane needs (an 200-day-old second copy
-- of a category, an unread row at a chosen age). The row *state* is what the archive/search/retention
-- surface reads, and the same posture holds in the live-DB tests for the same reason.
--
-- Every title is prefixed `UAT25a ` and carries a two-digit label so the probe can look its id up with an
-- exact-match query, and so teardown can prove it only ever deletes rows this file inserted.
--
-- What each fixture exists to prove, by label:
--   01  pinned + old + read            -> sorts above everything (pinned-first), never archived, never purged
--   02  old + read + unpinned          -> the archive-eligible case
--   03  old + read, security           -> protected category: not archived, not purged, even when eligible
--   04  old + read, system             -> the second default protected category
--   05  old + *unread*                 -> a sweep never archives what nobody has read
--   06  body contains a rare token     -> search reaches body, not only title
--   07  has a deep_link, mid age       -> the link survives the read/archive round trip; not past the horizon
--   08  newest row, unread             -> the read-stamp test and the newest-first ordering anchor
--   11  already archived at 100 days   -> the purge-eligible case
--   12  archived AND pinned            -> the guard refuses the DELETE, and the sweep never asks it to
--   13  archived AND protected         -> the same refusal for a category, not a row flag
--   14  archived AND unread            -> proves read-all does not reach into the archive half
--   15  sacrificial                    -> a plain DELETE that the guard *allows*, so the guard is not a blanket block
--   21  a different recipient          -> per-recipient archive, the admin pin-on-behalf path, and estate-wide sweeps
--   bulk 01..55                        -> the inbox is bigger than the old silent LIMIT 50, and paging must show it
BEGIN;

-- The lane estate is created over HTTP by the probe; these two join it. NOT EXISTS-guarded, so a re-seed
-- over an existing lane run changes nothing.
INSERT INTO estate_residents (estate_id, user_id, unit, role)
SELECT :'estate', :'res', 'UAT-25a', 'resident'
WHERE NOT EXISTS (SELECT 1 FROM estate_residents WHERE estate_id = :'estate' AND user_id = :'res');

INSERT INTO estate_residents (estate_id, user_id, unit, role)
SELECT :'estate', :'guard', 'UAT-25a-gate', 'resident'
WHERE NOT EXISTS (SELECT 1 FROM estate_residents WHERE estate_id = :'estate' AND user_id = :'guard');

WITH f(label, category, title, body, deep_link, age_days, age_min, is_read, is_pinned, archived_days) AS (
    VALUES
      ('01', 'general',     'UAT25a 01 pinned twenty',        'Pinned the day the gate roster was contested.',            NULL,                        200,  0, TRUE,  TRUE,  NULL),
      ('02', 'general',     'UAT25a 02 old general read',     'Ordinary notice, past every horizon, already read.',         NULL,                        200, 30, TRUE,  FALSE, NULL),
      ('03', 'security',    'UAT25a 03 old security read',    'A guard post verdict, two hundred days old.',               NULL,                        200, 31, TRUE,  FALSE, NULL),
      ('04', 'system',      'UAT25a 04 old system read',      'An administrative verdict the estate keeps.',               NULL,                        200, 32, TRUE,  FALSE, NULL),
      ('05', 'general',     'UAT25a 05 old general unread',   'Nobody has opened it; a schedule must not hide it.',         NULL,                        200, 33, FALSE, FALSE, NULL),
      ('06', 'payment',     'UAT25a 06 kairos body',          'Kairos generator deposit for the meeting hall.',             NULL,                          3, 10, FALSE, FALSE, NULL),
      ('07', 'maintenance', 'UAT25a 07 mid maintenance',      'Lift service window.',                                      'estate://maintenance/77',       5,  0, TRUE,  FALSE, NULL),
      ('08', 'general',     'UAT25a 08 newest general',       'The newest row in the inbox.',                              NULL,                          1,  0, FALSE, FALSE, NULL),
      ('11', 'general',     'UAT25a 11 archived old general', 'Already out of the inbox, already past the purge horizon.',  NULL,                       200, 40, TRUE,  FALSE, 100),
      ('12', 'general',     'UAT25a 12 archived pinned',      'Archived and pinned: the guard has to refuse its DELETE.',   NULL,                       200, 41, TRUE,  TRUE,  100),
      ('13', 'security',    'UAT25a 13 archived security',    'Archived but protected by category.',                        NULL,                       200, 42, TRUE,  FALSE, 100),
      ('14', 'general',     'UAT25a 14 archived unread',      'Archived without ever being read.',                           NULL,                       200, 43, FALSE, FALSE, 100),
      ('15', 'general',     'UAT25a 15 sacrificial',          'The one row a plain DELETE is allowed to take.',              NULL,                       200, 44, TRUE,  FALSE, NULL)
)
INSERT INTO estate_notifications (estate_id, user_id, category, title, body, deep_link, read_at, pinned, created_at, archived_at)
SELECT :'estate', :'res', f.category, f.title, f.body, f.deep_link,
       CASE WHEN f.is_read THEN NOW() - make_interval(days => f.age_days, mins => f.age_min) END,
       f.is_pinned,
       NOW() - make_interval(days => f.age_days, mins => f.age_min),
       CASE WHEN f.archived_days IS NULL THEN NULL ELSE NOW() - make_interval(days => f.archived_days) END
FROM f;

-- The guard's own copy of a notice in the same estate: what the resident does to their copy must not
-- happen to it, and what the sweep does is deliberately *not* per recipient.
INSERT INTO estate_notifications (estate_id, user_id, category, title, body, read_at, pinned, created_at)
SELECT :'estate', :'guard', 'general', 'UAT25a 21 guard copy', 'The same event, the gate keeper''s inbox.',
       NOW() - make_interval(days => 200, mins => 45), FALSE, NOW() - make_interval(days => 200, mins => 45)
WHERE NOT EXISTS (SELECT 1 FROM estate_notifications
                  WHERE estate_id = :'estate' AND user_id = :'guard' AND title = 'UAT25a 21 guard copy');

-- Fifty-five same-category rows, two days apart by a minute each so the ordering is total, and all of them
-- newer than the archive horizon: the pre-Phase-2.5a read answered with the newest 50 and said nothing
-- about the rest, which is the truncation the case is about.
INSERT INTO estate_notifications (estate_id, user_id, category, title, body, read_at, pinned, created_at)
SELECT :'estate', :'res', 'announcement',
       'UAT25a bulk ' || lpad(g::text, 2, '0'),
       'Bulk fixture ' || g || ' for the paging envelope.',
       NULL, FALSE,
       NOW() - make_interval(days => 2) + make_interval(mins => g)
FROM generate_series(1, 55) AS g
WHERE NOT EXISTS (SELECT 1 FROM estate_notifications n
                  WHERE n.estate_id = :'estate' AND n.title = 'UAT25a bulk ' || lpad(g::text, 2, '0'));

COMMIT;

-- What was seeded, so the transcript states the fixture shape rather than implying it.
SELECT count(*) AS lane_rows,
       count(*) FILTER (WHERE user_id = :'res') AS resident_rows,
       count(*) FILTER (WHERE archived_at IS NOT NULL) AS pre_archived,
       count(*) FILTER (WHERE read_at IS NULL) AS unread,
       count(*) FILTER (WHERE pinned) AS pinned
FROM estate_notifications WHERE estate_id = :'estate' AND title LIKE 'UAT25a %';
