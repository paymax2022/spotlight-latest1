-- Registration review seam + one-application-per-contest rule.
--
-- Two defects this closes, both visible in local data on 2026-08-30:
--
-- 1. An admin approval made from the console never put the applicant on the
--    voting roster. `RegistrationAdminStore.SetStatus` (Go) changes the status
--    and calls promote_registration_to_contestant() in ONE transaction, but the
--    admin console does not use that path — it goes through the Next handler
--    /api/admin/registration/applications/[id]/review, which updated
--    registrations.status directly and never called the seam. Result: four
--    approved registrations, one contestant. The applicant saw nothing in the
--    mobile app because there was nothing to see.
--
--    Rather than copy the promotion logic into a third place, the Next path now
--    calls this function, which does exactly what the Go transaction does. A
--    status change that cannot promote now rolls back instead of committing an
--    approved-but-unvotable entry.
--
-- 2. Nothing stopped a user applying to the same contest repeatedly. The same
--    account holds five registrations for `open-mic-competition` (two of them
--    approved). Enforced here as a partial unique index so the database, not
--    only the API, is the authority.
--
-- Additive-only: one new function, one new index, and a status collapse of
-- existing duplicates (no rows deleted — superseded entries become 'withdrawn',
-- which is a terminal status the index ignores and the audit trail records).

-- ---------------------------------------------------------------------------
-- 1. The review seam
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.review_registration_application(
  p_registration_id UUID,
  p_status          TEXT,
  p_note            TEXT DEFAULT NULL,
  p_actor_role      TEXT DEFAULT 'admin'
)
RETURNS TABLE (
  registration_id UUID,
  old_status      TEXT,
  new_status      TEXT,
  contestant_id   UUID,
  promoted        BOOLEAN,
  removed         BOOLEAN
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_old       TEXT;
  v_contestant UUID;
  v_promoted  BOOLEAN := FALSE;
  v_removed   BOOLEAN := FALSE;
  v_rows      INTEGER;
BEGIN
  -- Lock the row so two reviewers acting at once serialise rather than both
  -- reading the same old status and writing conflicting audit trails.
  SELECT status INTO v_old
    FROM public.registrations
   WHERE id = p_registration_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'registration % not found', p_registration_id
      USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE public.registrations
     SET status       = p_status,
         updated_at   = NOW(),
         withdrawn_at = CASE WHEN p_status = 'withdrawn' THEN NOW() ELSE withdrawn_at END
   WHERE id = p_registration_id;

  INSERT INTO public.registration_status_events (
    id, registration_id, old_status, new_status, note, actor_role, created_at
  ) VALUES (
    gen_random_uuid(), p_registration_id, v_old, p_status,
    NULLIF(p_note, ''), COALESCE(NULLIF(p_actor_role, ''), 'admin'), NOW()
  );

  IF p_status IN ('approved', 'selected_for_public_voting', 'selected_for_bootcamp') THEN
    v_contestant := public.promote_registration_to_contestant(p_registration_id);
    v_promoted   := TRUE;

  ELSIF p_status IN ('rejected', 'disqualified', 'withdrawn', 'eliminated') THEN
    -- Deactivate rather than delete: votes already cast reference this
    -- contestant, and the record of who competed must stay intact.
    UPDATE public.contestants
       SET status     = 'rejected',
           is_active  = FALSE,
           updated_at = NOW()
     WHERE contestants.registration_id = p_registration_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_removed := v_rows > 0;
  END IF;

  RETURN QUERY SELECT p_registration_id, v_old, p_status, v_contestant, v_promoted, v_removed;
END;
$$;

COMMENT ON FUNCTION public.review_registration_application(UUID, TEXT, TEXT, TEXT) IS
  'Applies an admin review decision: status change + audit event + roster '
  'promotion/deactivation, atomically. The Next admin route calls this so it '
  'cannot drift from the Go RegistrationAdminStore.SetStatus path.';

-- ---------------------------------------------------------------------------
-- 2. Collapse existing duplicates, newest-and-furthest-along wins
-- ---------------------------------------------------------------------------

WITH ranked AS (
  SELECT id, user_id, contest_slug,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, contest_slug
           ORDER BY
             CASE status
               WHEN 'winner'                     THEN 100
               WHEN 'selected_for_public_voting' THEN 90
               WHEN 'selected_for_bootcamp'      THEN 85
               WHEN 'approved'                   THEN 80
               WHEN 'callback_invited'           THEN 70
               WHEN 'shortlisted'                THEN 65
               WHEN 'audition_scheduled'         THEN 60
               WHEN 'under_review'               THEN 50
               WHEN 'more_information_requested' THEN 45
               WHEN 'waitlisted'                 THEN 40
               WHEN 'submitted'                  THEN 30
               WHEN 'awaiting_payment'           THEN 20
               WHEN 'draft'                      THEN 10
               ELSE 0
             END DESC,
             COALESCE(submitted_at, updated_at, created_at) DESC,
             created_at DESC,
             id DESC
         ) AS rn
    FROM public.registrations
   WHERE user_id IS NOT NULL
     AND status NOT IN ('withdrawn', 'rejected', 'disqualified', 'eliminated')
),
superseded AS (
  SELECT id FROM ranked WHERE rn > 1
),
events AS (
  INSERT INTO public.registration_status_events (
    id, registration_id, old_status, new_status, note, actor_role, created_at
  )
  SELECT gen_random_uuid(), r.id, r.status, 'withdrawn',
         'Superseded: one application per contest per user (migration 20270125000000)',
         'system', NOW()
    FROM public.registrations r
    JOIN superseded s ON s.id = r.id
  RETURNING registration_id
)
UPDATE public.registrations r
   SET status       = 'withdrawn',
       withdrawn_at = COALESCE(r.withdrawn_at, NOW()),
       updated_at   = NOW()
  FROM superseded s
 WHERE r.id = s.id;

-- ---------------------------------------------------------------------------
-- 3. One live application per user per contest
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS registrations_one_live_per_user_contest
  ON public.registrations (user_id, contest_slug)
  WHERE status NOT IN ('withdrawn', 'rejected', 'disqualified', 'eliminated');

COMMENT ON INDEX public.registrations_one_live_per_user_contest IS
  'A user may hold at most one live application per contest. Terminal statuses '
  'are excluded so a rejected or withdrawn applicant can apply again.';
