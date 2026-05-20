-- ============================================================
-- Analytics Helper Functions
-- Contest performance, voting trends, contestant popularity,
-- voter retention metrics
-- ============================================================

-- 1. Contest Performance Summary
CREATE OR REPLACE FUNCTION public.get_contest_performance()
RETURNS TABLE (
  contest_id UUID,
  contest_name TEXT,
  status TEXT,
  total_votes BIGINT,
  total_contestants BIGINT,
  total_voters BIGINT,
  free_votes BIGINT,
  paid_votes BIGINT,
  referral_votes BIGINT,
  bonus_votes BIGINT,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    c.id AS contest_id,
    c.name AS contest_name,
    c.status,
    COALESCE(SUM(cv.vote_count), 0) AS total_votes,
    COUNT(DISTINCT con.id) AS total_contestants,
    COUNT(DISTINCT cv.voter_ip) AS total_voters,
    COALESCE(SUM(CASE WHEN cv.vote_type = 'free' THEN cv.vote_count ELSE 0 END), 0) AS free_votes,
    COALESCE(SUM(CASE WHEN cv.vote_type = 'paid' THEN cv.vote_count ELSE 0 END), 0) AS paid_votes,
    COALESCE(SUM(CASE WHEN cv.vote_type = 'referral' THEN cv.vote_count ELSE 0 END), 0) AS referral_votes,
    COALESCE(SUM(CASE WHEN cv.vote_type = 'bonus' THEN cv.vote_count ELSE 0 END), 0) AS bonus_votes,
    c.start_date,
    c.end_date
  FROM public.contests c
  LEFT JOIN public.contestants con ON con.contest_id = c.id
  LEFT JOIN public.contestant_votes cv ON cv.contest_id = c.id
  GROUP BY c.id, c.name, c.status, c.start_date, c.end_date
  ORDER BY c.created_at DESC;
$$;

-- 2. Voting Trends (last 30 days, daily breakdown)
CREATE OR REPLACE FUNCTION public.get_voting_trends(days_back INTEGER DEFAULT 30)
RETURNS TABLE (
  vote_date DATE,
  total_votes BIGINT,
  free_votes BIGINT,
  paid_votes BIGINT,
  referral_votes BIGINT,
  bonus_votes BIGINT,
  unique_voters BIGINT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    DATE(cv.created_at) AS vote_date,
    SUM(cv.vote_count) AS total_votes,
    SUM(CASE WHEN cv.vote_type = 'free' THEN cv.vote_count ELSE 0 END) AS free_votes,
    SUM(CASE WHEN cv.vote_type = 'paid' THEN cv.vote_count ELSE 0 END) AS paid_votes,
    SUM(CASE WHEN cv.vote_type = 'referral' THEN cv.vote_count ELSE 0 END) AS referral_votes,
    SUM(CASE WHEN cv.vote_type = 'bonus' THEN cv.vote_count ELSE 0 END) AS bonus_votes,
    COUNT(DISTINCT cv.voter_ip) AS unique_voters
  FROM public.contestant_votes cv
  WHERE cv.created_at >= NOW() - (days_back || ' days')::INTERVAL
  GROUP BY DATE(cv.created_at)
  ORDER BY vote_date ASC;
$$;

-- 3. Contestant Popularity (for heatmap - votes per contestant per day)
CREATE OR REPLACE FUNCTION public.get_contestant_popularity(days_back INTEGER DEFAULT 14)
RETURNS TABLE (
  contestant_id UUID,
  contestant_name TEXT,
  photo_url TEXT,
  contest_name TEXT,
  vote_date DATE,
  daily_votes BIGINT,
  total_votes BIGINT,
  ranking INTEGER
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    con.id AS contestant_id,
    con.name AS contestant_name,
    con.photo_url,
    c.name AS contest_name,
    DATE(cv.created_at) AS vote_date,
    SUM(cv.vote_count) AS daily_votes,
    con.total_votes,
    con.ranking
  FROM public.contestants con
  JOIN public.contests c ON c.id = con.contest_id
  LEFT JOIN public.contestant_votes cv ON cv.contestant_id = con.id
    AND cv.created_at >= NOW() - (days_back || ' days')::INTERVAL
  WHERE con.total_votes > 0
  GROUP BY con.id, con.name, con.photo_url, c.name, DATE(cv.created_at), con.total_votes, con.ranking
  ORDER BY con.total_votes DESC, vote_date ASC;
$$;

-- 4. Voter Retention Metrics
CREATE OR REPLACE FUNCTION public.get_voter_retention(days_back INTEGER DEFAULT 30)
RETURNS TABLE (
  cohort_date DATE,
  new_voters BIGINT,
  returning_voters BIGINT,
  total_voters BIGINT,
  retention_rate NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH daily_voters AS (
    SELECT
      DATE(created_at) AS vote_date,
      voter_ip,
      MIN(DATE(created_at)) OVER (PARTITION BY voter_ip) AS first_vote_date
    FROM public.contestant_votes
    WHERE created_at >= NOW() - (days_back || ' days')::INTERVAL
  ),
  aggregated AS (
    SELECT
      vote_date,
      COUNT(DISTINCT voter_ip) AS total_voters,
      COUNT(DISTINCT CASE WHEN vote_date = first_vote_date THEN voter_ip END) AS new_voters,
      COUNT(DISTINCT CASE WHEN vote_date > first_vote_date THEN voter_ip END) AS returning_voters
    FROM daily_voters
    GROUP BY vote_date
  )
  SELECT
    vote_date AS cohort_date,
    new_voters,
    returning_voters,
    total_voters,
    CASE WHEN total_voters > 0
      THEN ROUND((returning_voters::NUMERIC / total_voters::NUMERIC) * 100, 1)
      ELSE 0
    END AS retention_rate
  FROM aggregated
  ORDER BY vote_date ASC;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_contest_performance() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_voting_trends(INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_contestant_popularity(INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_voter_retention(INTEGER) TO anon, authenticated;
