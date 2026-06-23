-- Reality TV Show: Stages, Bootcamp Contestants & Weekly Evictions
-- Phase 1 = Audition, Phase 2 = Bootcamp with weekly judge/admin eviction voting.

BEGIN;

-- ── Season container ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reality_show_seasons (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_name           TEXT NOT NULL,                         -- e.g. "Season 1"
  season_number         INTEGER NOT NULL DEFAULT 1,
  contest_slug          TEXT NOT NULL DEFAULT 'reality-tv-show',
  current_phase         TEXT NOT NULL DEFAULT 'pre_audition',
  -- pre_audition | audition | bootcamp | finale | completed
  audition_start_date   DATE,
  audition_end_date     DATE,
  bootcamp_start_date   DATE,
  bootcamp_end_date     DATE,
  status                TEXT NOT NULL DEFAULT 'draft',         -- draft | active | completed
  notes                 TEXT NOT NULL DEFAULT '',
  created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── Contestants promoted into the show ───────────────────────────────────────
-- Populated when admin promotes an approved audition applicant into the show.
CREATE TABLE IF NOT EXISTS public.reality_show_contestants (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id             UUID NOT NULL REFERENCES public.reality_show_seasons(id) ON DELETE CASCADE,
  application_id        UUID REFERENCES public.contest_registration_applications(id) ON DELETE SET NULL,
  user_id               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name          TEXT NOT NULL,
  stage_name            TEXT NOT NULL DEFAULT '',
  primary_talent        TEXT NOT NULL DEFAULT '',
  photo_url             TEXT NOT NULL DEFAULT '',
  phase_status          TEXT NOT NULL DEFAULT 'audition',
  -- audition | bootcamp | evicted | finalist | winner
  audition_result       TEXT NOT NULL DEFAULT 'pending',
  -- pending | passed | failed
  entered_bootcamp_at   TIMESTAMPTZ,
  evicted_at            TIMESTAMPTZ,
  evicted_week          INTEGER,
  finalist_position     INTEGER,                               -- 1=winner, 2=runner-up, etc.
  is_active             BOOLEAN NOT NULL DEFAULT true,
  bio_notes             TEXT NOT NULL DEFAULT '',
  created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(season_id, application_id)
);

-- ── Weekly eviction rounds ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reality_show_weeks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id             UUID NOT NULL REFERENCES public.reality_show_seasons(id) ON DELETE CASCADE,
  week_number           INTEGER NOT NULL,
  title                 TEXT NOT NULL DEFAULT '',              -- e.g. "Week 3 Eviction Night"
  theme                 TEXT NOT NULL DEFAULT '',              -- optional weekly theme
  voting_opens_at       TIMESTAMPTZ,
  voting_closes_at      TIMESTAMPTZ,
  status                TEXT NOT NULL DEFAULT 'upcoming',
  -- upcoming | open | closed | eviction_declared
  eviction_count        INTEGER NOT NULL DEFAULT 1,           -- how many to evict this week
  eviction_finalized    BOOLEAN NOT NULL DEFAULT false,
  created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(season_id, week_number)
);

-- ── Admin / judge eviction votes ─────────────────────────────────────────────
-- Each voter can cast one vote per contestant per week (nominate for eviction).
CREATE TABLE IF NOT EXISTS public.reality_show_eviction_votes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id               UUID NOT NULL REFERENCES public.reality_show_weeks(id) ON DELETE CASCADE,
  voter_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  voter_name            TEXT NOT NULL DEFAULT '',
  voter_role            TEXT NOT NULL DEFAULT 'judge',        -- admin | judge
  contestant_id         UUID NOT NULL REFERENCES public.reality_show_contestants(id) ON DELETE CASCADE,
  reason                TEXT NOT NULL DEFAULT '',
  voted_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(week_id, voter_id, contestant_id)
);

-- ── Finalized eviction records ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reality_show_evictions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id               UUID NOT NULL REFERENCES public.reality_show_weeks(id) ON DELETE CASCADE,
  season_id             UUID NOT NULL REFERENCES public.reality_show_seasons(id) ON DELETE CASCADE,
  contestant_id         UUID NOT NULL REFERENCES public.reality_show_contestants(id) ON DELETE CASCADE,
  vote_count            INTEGER NOT NULL DEFAULT 0,
  eviction_order        INTEGER NOT NULL DEFAULT 1,           -- if multiple evicted: 1st, 2nd…
  eviction_note         TEXT NOT NULL DEFAULT '',
  evicted_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  evicted_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(week_id, contestant_id)
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rs_seasons_status      ON public.reality_show_seasons(status, season_number DESC);
CREATE INDEX IF NOT EXISTS idx_rs_contestants_season  ON public.reality_show_contestants(season_id, phase_status);
CREATE INDEX IF NOT EXISTS idx_rs_contestants_active  ON public.reality_show_contestants(season_id, is_active);
CREATE INDEX IF NOT EXISTS idx_rs_weeks_season        ON public.reality_show_weeks(season_id, week_number);
CREATE INDEX IF NOT EXISTS idx_rs_votes_week          ON public.reality_show_eviction_votes(week_id, contestant_id);
CREATE INDEX IF NOT EXISTS idx_rs_votes_voter         ON public.reality_show_eviction_votes(voter_id, week_id);
CREATE INDEX IF NOT EXISTS idx_rs_evictions_week      ON public.reality_show_evictions(week_id);
CREATE INDEX IF NOT EXISTS idx_rs_evictions_season    ON public.reality_show_evictions(season_id, evicted_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.reality_show_seasons         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reality_show_contestants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reality_show_weeks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reality_show_eviction_votes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reality_show_evictions       ENABLE ROW LEVEL SECURITY;

-- Admins and judges full access; public read for seasons/contestants only
CREATE POLICY "rs_seasons_admin"     ON public.reality_show_seasons         FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "rs_contestants_admin" ON public.reality_show_contestants      FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "rs_weeks_admin"       ON public.reality_show_weeks            FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "rs_votes_admin"       ON public.reality_show_eviction_votes   FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "rs_evictions_admin"   ON public.reality_show_evictions        FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Judges can read seasons/weeks and insert their own votes
CREATE POLICY "rs_seasons_judge_read"    ON public.reality_show_seasons       FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "rs_weeks_judge_read"      ON public.reality_show_weeks         FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "rs_contestants_judge_read" ON public.reality_show_contestants  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "rs_votes_judge_insert"    ON public.reality_show_eviction_votes FOR INSERT
  WITH CHECK (auth.uid() = voter_id);
CREATE POLICY "rs_votes_judge_own_read"  ON public.reality_show_eviction_votes FOR SELECT
  USING (voter_id = auth.uid() OR public.is_admin());

-- ── updated_at triggers ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rs_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END; $$;

CREATE TRIGGER trg_rs_seasons_updated       BEFORE UPDATE ON public.reality_show_seasons        FOR EACH ROW EXECUTE FUNCTION public.rs_touch_updated_at();
CREATE TRIGGER trg_rs_contestants_updated   BEFORE UPDATE ON public.reality_show_contestants     FOR EACH ROW EXECUTE FUNCTION public.rs_touch_updated_at();
CREATE TRIGGER trg_rs_weeks_updated         BEFORE UPDATE ON public.reality_show_weeks           FOR EACH ROW EXECUTE FUNCTION public.rs_touch_updated_at();

-- ── Convenience view: vote tallies per week ───────────────────────────────────
CREATE OR REPLACE VIEW public.reality_show_vote_tallies AS
SELECT
  v.week_id,
  v.contestant_id,
  c.display_name,
  c.stage_name,
  c.primary_talent,
  c.phase_status,
  COUNT(v.id)::INTEGER AS vote_count
FROM public.reality_show_eviction_votes v
JOIN public.reality_show_contestants c ON c.id = v.contestant_id
GROUP BY v.week_id, v.contestant_id, c.display_name, c.stage_name, c.primary_talent, c.phase_status;

COMMIT;
