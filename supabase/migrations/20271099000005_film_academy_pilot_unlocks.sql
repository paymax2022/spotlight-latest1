-- ── Film Academy: audited pilot delivery unlock ─────────────────────────────
-- Additive-only. Publication is an academic gate that faculty and SMEs own, and
-- no pilot can clear it honestly: the curriculum is not reviewed yet. This table
-- lets an administrator open ONE COURSE for pilot delivery anyway, as an
-- explicitly labelled exception, so the sequential path can be exercised with
-- real learners before the review is finished.
--
-- What a pilot unlock does and does not do:
--   • It substitutes for the "topic is published" and "question pool is reviewed"
--     preconditions only. Prerequisite sequencing, the 85% pass threshold,
--     academic holds and remediation all keep working unchanged.
--   • It never writes film_topics.published, content_status or any question's
--     status. A pilot completion is therefore invisible to certificate
--     issuance, which counts published topics, so no credential can be minted
--     from unreviewed material.
--   • Every enable and revoke is recorded in film_academic_audit with a written
--     reason, and the service only honours it outside production.
--
-- One row per course, so a pilot is a deliberate, scoped decision rather than a
-- global switch. Revoking keeps the row (revoked_at set) as the history of the
-- exception; re-enabling updates it in place.

CREATE TABLE IF NOT EXISTS public.film_pilot_unlocks (
    course_id   text PRIMARY KEY
                REFERENCES public.film_courses(course_id) ON DELETE CASCADE,
    -- A blank or rubber-stamped reason defeats the purpose of the audit trail,
    -- so the database itself refuses it.
    note        text NOT NULL CHECK (char_length(btrim(note)) >= 10),
    enabled_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    enabled_at  timestamptz NOT NULL DEFAULT now(),
    revoked_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    revoked_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.film_pilot_unlocks IS
    'Administrator-scoped pilot delivery exceptions, one per course. Opens a course''s sequence for real learners WITHOUT publishing or approving any content; honoured only when the pilot feature flag is on and the environment is not production.';
COMMENT ON COLUMN public.film_pilot_unlocks.note IS
    'Why this course is being delivered unreviewed. Required, minimum 10 characters, mirrored into film_academic_audit.';
COMMENT ON COLUMN public.film_pilot_unlocks.revoked_at IS
    'Null while the pilot is active. A pilot is active only when revoked_at IS NULL.';

CREATE INDEX IF NOT EXISTS film_pilot_unlocks_active_idx
    ON public.film_pilot_unlocks (revoked_at, course_id);

-- ─── RLS: private rows are service-role only ────────────────────────────────
ALTER TABLE public.film_pilot_unlocks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.film_pilot_unlocks FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.film_pilot_unlocks TO service_role;
