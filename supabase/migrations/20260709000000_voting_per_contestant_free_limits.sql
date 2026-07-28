-- Per-contestant daily free-vote cap.
-- Additive-only. No DROP TABLE/COLUMN/TYPE, no RENAME, no type narrowing.
--
-- Each voter gets up to N free votes PER CONTESTANT per day (default 3). When
-- the cap for a contestant is reached, free voting for that contestant is
-- disabled until the daily reset (24h cycle). This table tracks usage per
-- (contest, contestant, voter, day). The existing voter_daily_limits remains a
-- contest-wide tally and only blocks when an explicit per-contest cap is set.

CREATE TABLE IF NOT EXISTS public.voter_contestant_daily_limits (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id              uuid NOT NULL REFERENCES public.contests(id),
  contestant_id           uuid NOT NULL,                          -- entry/submission id (matches votes.contestant_id; unconstrained like votes)
  voter_identifier        text NOT NULL,                          -- user_id | email | phone | device | ip
  voter_identifier_type   text NOT NULL
                            CHECK (voter_identifier_type IN ('user','email','phone','device','ip','session')),
  vote_date               date NOT NULL,
  free_votes_used         integer NOT NULL DEFAULT 0,
  free_votes_limit        integer NOT NULL DEFAULT 3,
  last_vote_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE(contest_id, contestant_id, voter_identifier, voter_identifier_type, vote_date)
);

CREATE INDEX IF NOT EXISTS voter_contestant_daily_limits_lookup_idx
  ON public.voter_contestant_daily_limits (contest_id, contestant_id, voter_identifier, voter_identifier_type, vote_date);

ALTER TABLE public.voter_contestant_daily_limits ENABLE ROW LEVEL SECURITY;

-- service_role manages all rows (the engine runs server-side with the admin key).
DROP POLICY IF EXISTS "voter_contestant_daily_limits_service_role" ON public.voter_contestant_daily_limits;
CREATE POLICY "voter_contestant_daily_limits_service_role"
  ON public.voter_contestant_daily_limits FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
