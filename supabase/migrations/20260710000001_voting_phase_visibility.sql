-- Per-contest AND per-phase visibility for leaderboard / vote count / rank.
-- Additive-only. No DROP TABLE/COLUMN/TYPE, no RENAME, no type narrowing.
--
-- Contest-level flags already exist on voting_settings
-- (show_public_vote_count / show_public_leaderboard / show_public_rank). This
-- migration adds an OPTIONAL per-phase override: an admin can define phases for
-- a contest, give each its own visibility flags, and mark one phase active. When
-- a phase is active, its flags win; otherwise the contest-level flags apply.

-- Which phase is currently active (NULL = use contest-level flags).
ALTER TABLE public.voting_settings ADD COLUMN IF NOT EXISTS active_phase_key text;

CREATE TABLE IF NOT EXISTS public.voting_phases (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id               uuid NOT NULL REFERENCES public.contests(id),
  phase_key                text NOT NULL,                 -- stable id, e.g. 'auditions', 'finals'
  phase_label              text NOT NULL,                 -- human label
  show_public_vote_count   boolean NOT NULL DEFAULT true,
  show_public_leaderboard  boolean NOT NULL DEFAULT true,
  show_public_rank         boolean NOT NULL DEFAULT true,
  sort_order               integer NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE(contest_id, phase_key)
);

CREATE INDEX IF NOT EXISTS voting_phases_contest_idx ON public.voting_phases (contest_id, sort_order);

ALTER TABLE public.voting_phases ENABLE ROW LEVEL SECURITY;

-- Public read so the app can resolve effective visibility; service_role writes
-- (admin runs server-side with the admin key).
DROP POLICY IF EXISTS "voting_phases_public_select" ON public.voting_phases;
CREATE POLICY "voting_phases_public_select"
  ON public.voting_phases FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "voting_phases_service_role" ON public.voting_phases;
CREATE POLICY "voting_phases_service_role"
  ON public.voting_phases FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
