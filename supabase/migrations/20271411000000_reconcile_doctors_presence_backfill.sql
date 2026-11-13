-- Put online clinicians back in the patient "Available now" rail.
--
-- Problem: patients count online doctors from the denormalised doctors.is_online
-- column — backend/internal/telemedicine/service.go:180 adds `d.is_online = TRUE`
-- for available_now, and :215 reads it into the list rows. Nothing in the backend
-- ever set that column from the doctor's own presence: the only statement that
-- wrote it, PATCH /telemedicine/doctor/availability (service.go:269), has no
-- client caller at all. So doctors.is_online kept the FALSE DEFAULT its row was
-- created with, while the provider app read the doctor_profiles side and showed
-- "Online · Accepting instant". Reported symptom: Doctor Abiaka online, every
-- patient seeing "0 online".
--
-- bd3089f3a fixed the write path (SetPresence now projects presence onto the
-- directory row). That fix is FORWARD ONLY — like the phone backfill below, it
-- repairs nothing that already disagrees. A stale row self-corrects only when that
-- doctor next toggles presence, which for a doctor who is online and stays online
-- is never. This repairs those rows.
--
-- The repair lives in a function rather than as a bare UPDATE so it can be
-- asserted on (backend/internal/doctor/presence_directory_projection_live_db_test.go
-- covers both directions, the repeat call and the suspension guard) and so an
-- operator can re-run it after any future write-path regression.
--
-- SCOPE: presence ONLY. doctors.is_available is the LISTING flag, owned by review
-- (telemedadmin) and by compliance suspension — never touched here. Rows match on
-- user_id, so a profile with no directory row still gets none: creating rows here
-- would list doctors nobody approved.
--
-- doctors_block_when_suspended (20271099000090) is a BEFORE UPDATE OF is_online
-- trigger on this very statement, so a clinician whose profile is suspended cannot
-- be put online by this repair.
--
-- Additive only: CREATE OR REPLACE FUNCTION + one call. No DROP, no rename, no
-- type narrowing. Re-running it is a no-op — it writes only rows that disagree
-- with their own profile.
--
-- Precedent for a forward-only fix needing a paired backfill:
-- 20261224000000_user_profiles_phone_backfill.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_doctors_presence()
RETURNS integer
LANGUAGE sql
SET search_path = public
AS $$
  WITH repaired AS (
    UPDATE doctors d
    SET    is_online = (p.presence = 'online')
    FROM   doctor_profiles p
    WHERE  p.user_id = d.user_id
      AND  d.is_online IS DISTINCT FROM (p.presence = 'online')
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM repaired
$$;

-- Run it once at apply time and say what it did, so the deploy log carries the
-- count instead of a silent success.
DO $$
DECLARE
  repaired integer;
BEGIN
  repaired := public.reconcile_doctors_presence();
  RAISE NOTICE 'reconcile_doctors_presence: repaired % doctors.is_online row(s)', repaired;
END $$;

COMMIT;
