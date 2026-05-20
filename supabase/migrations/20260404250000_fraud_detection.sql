-- ============================================================
-- Fraud Detection System
-- Tables: vote_fraud_logs, fraud_flags, ip_velocity_tracking, device_tracking
-- ============================================================

-- 1. TYPES
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'fraud_severity'
  ) THEN
    CREATE TYPE public.fraud_severity AS ENUM ('low', 'medium', 'high', 'critical');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'fraud_status'
  ) THEN
    CREATE TYPE public.fraud_status AS ENUM ('pending', 'reviewed', 'confirmed', 'dismissed');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'fraud_type'
  ) THEN
    CREATE TYPE public.fraud_type AS ENUM (
      'ip_velocity',
      'device_velocity',
      'geo_velocity',
      'duplicate_vote',
      'vote_burst',
      'suspicious_pattern',
      'bot_behavior'
    );
  END IF;
END $$;

-- 2. TABLES

-- IP velocity tracking: tracks vote counts per IP per time window
CREATE TABLE IF NOT EXISTS public.ip_velocity_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voter_ip TEXT NOT NULL DEFAULT '',
  contest_id UUID REFERENCES public.contests(id) ON DELETE CASCADE,
  vote_count INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  window_end TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 hour'),
  last_vote_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ip_velocity_ip ON public.ip_velocity_tracking(voter_ip);
CREATE INDEX IF NOT EXISTS idx_ip_velocity_contest ON public.ip_velocity_tracking(contest_id);
CREATE INDEX IF NOT EXISTS idx_ip_velocity_window ON public.ip_velocity_tracking(window_start, window_end);

-- Device tracking: tracks vote counts per device fingerprint
CREATE TABLE IF NOT EXISTS public.device_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_fingerprint TEXT NOT NULL DEFAULT '',
  voter_ip TEXT NOT NULL DEFAULT '',
  contest_id UUID REFERENCES public.contests(id) ON DELETE CASCADE,
  vote_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_changes INTEGER NOT NULL DEFAULT 0,
  geo_country TEXT NOT NULL DEFAULT '',
  geo_region TEXT NOT NULL DEFAULT '',
  geo_city TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_device_tracking_fingerprint ON public.device_tracking(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_device_tracking_ip ON public.device_tracking(voter_ip);
CREATE INDEX IF NOT EXISTS idx_device_tracking_contest ON public.device_tracking(contest_id);

-- Fraud flags: suspicious activity records for admin review
CREATE TABLE IF NOT EXISTS public.fraud_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vote_id UUID REFERENCES public.contestant_votes(id) ON DELETE SET NULL,
  contestant_id UUID REFERENCES public.contestants(id) ON DELETE CASCADE,
  contest_id UUID REFERENCES public.contests(id) ON DELETE CASCADE,
  voter_ip TEXT NOT NULL DEFAULT '',
  device_fingerprint TEXT NOT NULL DEFAULT '',
  fraud_type public.fraud_type NOT NULL DEFAULT 'suspicious_pattern',
  severity public.fraud_severity NOT NULL DEFAULT 'medium',
  status public.fraud_status NOT NULL DEFAULT 'pending',
  description TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  votes_affected INTEGER NOT NULL DEFAULT 0,
  reviewed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT NOT NULL DEFAULT '',
  auto_flagged BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fraud_flags_status ON public.fraud_flags(status);
CREATE INDEX IF NOT EXISTS idx_fraud_flags_severity ON public.fraud_flags(severity);
CREATE INDEX IF NOT EXISTS idx_fraud_flags_contestant ON public.fraud_flags(contestant_id);
CREATE INDEX IF NOT EXISTS idx_fraud_flags_contest ON public.fraud_flags(contest_id);
CREATE INDEX IF NOT EXISTS idx_fraud_flags_ip ON public.fraud_flags(voter_ip);
CREATE INDEX IF NOT EXISTS idx_fraud_flags_created ON public.fraud_flags(created_at DESC);

-- Vote fraud logs: detailed audit trail of all fraud checks
CREATE TABLE IF NOT EXISTS public.vote_fraud_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vote_id UUID REFERENCES public.contestant_votes(id) ON DELETE SET NULL,
  contestant_id UUID REFERENCES public.contestants(id) ON DELETE CASCADE,
  contest_id UUID REFERENCES public.contests(id) ON DELETE CASCADE,
  voter_ip TEXT NOT NULL DEFAULT '',
  device_fingerprint TEXT NOT NULL DEFAULT '',
  vote_type TEXT NOT NULL DEFAULT 'free',
  check_passed BOOLEAN NOT NULL DEFAULT true,
  fraud_score INTEGER NOT NULL DEFAULT 0,
  checks_performed JSONB NOT NULL DEFAULT '[]',
  geo_country TEXT NOT NULL DEFAULT '',
  geo_region TEXT NOT NULL DEFAULT '',
  geo_city TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vote_fraud_logs_vote ON public.vote_fraud_logs(vote_id);
CREATE INDEX IF NOT EXISTS idx_vote_fraud_logs_ip ON public.vote_fraud_logs(voter_ip);
CREATE INDEX IF NOT EXISTS idx_vote_fraud_logs_device ON public.vote_fraud_logs(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_vote_fraud_logs_created ON public.vote_fraud_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vote_fraud_logs_score ON public.vote_fraud_logs(fraud_score DESC);

-- 3. FUNCTIONS

-- Function: run fraud checks on a vote and return fraud score + flags
CREATE OR REPLACE FUNCTION public.run_fraud_checks(
  p_vote_id UUID,
  p_contestant_id UUID,
  p_contest_id UUID,
  p_voter_ip TEXT,
  p_device_fingerprint TEXT,
  p_vote_type TEXT,
  p_vote_count INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_fraud_score INTEGER := 0;
  v_checks JSONB := '[]'::JSONB;
  v_flags JSONB := '[]'::JSONB;
  v_ip_votes_1h INTEGER := 0;
  v_ip_votes_24h INTEGER := 0;
  v_device_votes_1h INTEGER := 0;
  v_device_votes_24h INTEGER := 0;
  v_device_ip_changes INTEGER := 0;
  v_burst_count INTEGER := 0;
  v_result JSONB;
BEGIN
  -- Check 1: IP velocity (votes per hour from same IP)
  SELECT COUNT(*) INTO v_ip_votes_1h
  FROM public.contestant_votes
  WHERE voter_ip = p_voter_ip
    AND created_at >= NOW() - INTERVAL '1 hour';

  SELECT COUNT(*) INTO v_ip_votes_24h
  FROM public.contestant_votes
  WHERE voter_ip = p_voter_ip
    AND created_at >= NOW() - INTERVAL '24 hours';

  IF v_ip_votes_1h >= 20 THEN
    v_fraud_score := v_fraud_score + 40;
    v_flags := v_flags || jsonb_build_object('type', 'ip_velocity', 'detail', format('IP %s cast %s votes in last hour', p_voter_ip, v_ip_votes_1h));
  ELSIF v_ip_votes_1h >= 10 THEN
    v_fraud_score := v_fraud_score + 20;
  END IF;

  IF v_ip_votes_24h >= 100 THEN
    v_fraud_score := v_fraud_score + 30;
    v_flags := v_flags || jsonb_build_object('type', 'ip_velocity', 'detail', format('IP %s cast %s votes in last 24h', p_voter_ip, v_ip_votes_24h));
  END IF;

  v_checks := v_checks || jsonb_build_object('check', 'ip_velocity', 'ip_votes_1h', v_ip_votes_1h, 'ip_votes_24h', v_ip_votes_24h);

  -- Check 2: Device velocity (votes per hour from same device)
  SELECT COUNT(*) INTO v_device_votes_1h
  FROM public.contestant_votes
  WHERE device_fingerprint = p_device_fingerprint
    AND created_at >= NOW() - INTERVAL '1 hour';

  SELECT COUNT(*) INTO v_device_votes_24h
  FROM public.contestant_votes
  WHERE device_fingerprint = p_device_fingerprint
    AND created_at >= NOW() - INTERVAL '24 hours';

  IF v_device_votes_1h >= 15 THEN
    v_fraud_score := v_fraud_score + 35;
    v_flags := v_flags || jsonb_build_object('type', 'device_velocity', 'detail', format('Device cast %s votes in last hour', v_device_votes_1h));
  ELSIF v_device_votes_1h >= 8 THEN
    v_fraud_score := v_fraud_score + 15;
  END IF;

  v_checks := v_checks || jsonb_build_object('check', 'device_velocity', 'device_votes_1h', v_device_votes_1h, 'device_votes_24h', v_device_votes_24h);

  -- Check 3: Device IP changes (geo velocity proxy)
  SELECT COALESCE(ip_changes, 0) INTO v_device_ip_changes
  FROM public.device_tracking
  WHERE device_fingerprint = p_device_fingerprint
    AND (contest_id = p_contest_id OR contest_id IS NULL)
  ORDER BY last_seen_at DESC
  LIMIT 1;

  IF v_device_ip_changes >= 5 THEN
    v_fraud_score := v_fraud_score + 25;
    v_flags := v_flags || jsonb_build_object('type', 'geo_velocity', 'detail', format('Device changed IP %s times', v_device_ip_changes));
  ELSIF v_device_ip_changes >= 3 THEN
    v_fraud_score := v_fraud_score + 10;
  END IF;

  v_checks := v_checks || jsonb_build_object('check', 'geo_velocity', 'ip_changes', v_device_ip_changes);

  -- Check 4: Vote burst detection (many votes in 5 minutes)
  SELECT COUNT(*) INTO v_burst_count
  FROM public.contestant_votes
  WHERE (voter_ip = p_voter_ip OR device_fingerprint = p_device_fingerprint)
    AND contestant_id = p_contestant_id
    AND created_at >= NOW() - INTERVAL '5 minutes';

  IF v_burst_count >= 10 THEN
    v_fraud_score := v_fraud_score + 30;
    v_flags := v_flags || jsonb_build_object('type', 'vote_burst', 'detail', format('%s votes for same contestant in 5 minutes', v_burst_count));
  ELSIF v_burst_count >= 5 THEN
    v_fraud_score := v_fraud_score + 15;
  END IF;

  v_checks := v_checks || jsonb_build_object('check', 'vote_burst', 'burst_count', v_burst_count);

  -- Update IP velocity tracking
  INSERT INTO public.ip_velocity_tracking (voter_ip, contest_id, vote_count, window_start, window_end, last_vote_at)
  VALUES (p_voter_ip, p_contest_id, 1, date_trunc('hour', NOW()), date_trunc('hour', NOW()) + INTERVAL '1 hour', NOW())
  ON CONFLICT DO NOTHING;

  UPDATE public.ip_velocity_tracking
  SET vote_count = vote_count + 1, last_vote_at = NOW(), updated_at = NOW()
  WHERE voter_ip = p_voter_ip
    AND (contest_id = p_contest_id OR (contest_id IS NULL AND p_contest_id IS NULL))
    AND window_start = date_trunc('hour', NOW());

  -- Update device tracking
  INSERT INTO public.device_tracking (device_fingerprint, voter_ip, contest_id, vote_count, first_seen_at, last_seen_at, ip_changes)
  VALUES (p_device_fingerprint, p_voter_ip, p_contest_id, 1, NOW(), NOW(), 0)
  ON CONFLICT DO NOTHING;

  UPDATE public.device_tracking
  SET
    vote_count = vote_count + 1,
    last_seen_at = NOW(),
    ip_changes = CASE WHEN voter_ip != p_voter_ip THEN ip_changes + 1 ELSE ip_changes END,
    voter_ip = p_voter_ip,
    updated_at = NOW()
  WHERE device_fingerprint = p_device_fingerprint
    AND (contest_id = p_contest_id OR (contest_id IS NULL AND p_contest_id IS NULL));

  -- Build result
  v_result := jsonb_build_object(
    'fraud_score', v_fraud_score,
    'check_passed', v_fraud_score < 70,
    'flags', v_flags,
    'checks', v_checks,
    'ip_votes_1h', v_ip_votes_1h,
    'device_votes_1h', v_device_votes_1h
  );

  -- Auto-create fraud flags for high-score votes
  IF v_fraud_score >= 40 AND p_vote_id IS NOT NULL THEN
    DECLARE
      v_flag_type public.fraud_type;
      v_severity public.fraud_severity;
      v_flag JSONB;
    BEGIN
      FOR v_flag IN SELECT jsonb_array_elements(v_flags)
      LOOP
        v_flag_type := (v_flag->>'type')::public.fraud_type;
        v_severity := CASE
          WHEN v_fraud_score >= 80 THEN 'critical'::public.fraud_severity
          WHEN v_fraud_score >= 60 THEN 'high'::public.fraud_severity
          WHEN v_fraud_score >= 40 THEN 'medium'::public.fraud_severity
          ELSE 'low'::public.fraud_severity
        END;

        INSERT INTO public.fraud_flags (
          vote_id, contestant_id, contest_id, voter_ip, device_fingerprint,
          fraud_type, severity, status, description, metadata, votes_affected, auto_flagged
        ) VALUES (
          p_vote_id, p_contestant_id, p_contest_id, p_voter_ip, p_device_fingerprint,
          v_flag_type, v_severity, 'pending',
          v_flag->>'detail',
          jsonb_build_object('fraud_score', v_fraud_score, 'checks', v_checks),
          p_vote_count, true
        );
      END LOOP;
    END;
  END IF;

  RETURN v_result;
END;
$$;

-- Function: get fraud summary stats for admin dashboard
CREATE OR REPLACE FUNCTION public.get_fraud_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_flags', (SELECT COUNT(*) FROM public.fraud_flags),
    'pending_flags', (SELECT COUNT(*) FROM public.fraud_flags WHERE status = 'pending'),
    'confirmed_fraud', (SELECT COUNT(*) FROM public.fraud_flags WHERE status = 'confirmed'),
    'dismissed', (SELECT COUNT(*) FROM public.fraud_flags WHERE status = 'dismissed'),
    'critical_flags', (SELECT COUNT(*) FROM public.fraud_flags WHERE severity = 'critical' AND status = 'pending'),
    'high_flags', (SELECT COUNT(*) FROM public.fraud_flags WHERE severity = 'high' AND status = 'pending'),
    'flagged_votes_today', (SELECT COUNT(*) FROM public.fraud_flags WHERE created_at >= CURRENT_DATE),
    'unique_suspicious_ips', (SELECT COUNT(DISTINCT voter_ip) FROM public.fraud_flags WHERE status = 'pending'),
    'unique_suspicious_devices', (SELECT COUNT(DISTINCT device_fingerprint) FROM public.fraud_flags WHERE status = 'pending')
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- 4. ENABLE RLS
ALTER TABLE public.ip_velocity_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fraud_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vote_fraud_logs ENABLE ROW LEVEL SECURITY;

-- 5. RLS POLICIES

-- ip_velocity_tracking: public insert (votes come from anon), authenticated read
DROP POLICY IF EXISTS "public_insert_ip_velocity" ON public.ip_velocity_tracking;
CREATE POLICY "public_insert_ip_velocity" ON public.ip_velocity_tracking
FOR INSERT TO public WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_read_ip_velocity" ON public.ip_velocity_tracking;
CREATE POLICY "authenticated_read_ip_velocity" ON public.ip_velocity_tracking
FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_update_ip_velocity" ON public.ip_velocity_tracking;
CREATE POLICY "authenticated_update_ip_velocity" ON public.ip_velocity_tracking
FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- device_tracking: public insert, authenticated read/update
DROP POLICY IF EXISTS "public_insert_device_tracking" ON public.device_tracking;
CREATE POLICY "public_insert_device_tracking" ON public.device_tracking
FOR INSERT TO public WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_read_device_tracking" ON public.device_tracking;
CREATE POLICY "authenticated_read_device_tracking" ON public.device_tracking
FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_update_device_tracking" ON public.device_tracking;
CREATE POLICY "authenticated_update_device_tracking" ON public.device_tracking
FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- fraud_flags: public insert (auto-flagging), authenticated full access
DROP POLICY IF EXISTS "public_insert_fraud_flags" ON public.fraud_flags;
CREATE POLICY "public_insert_fraud_flags" ON public.fraud_flags
FOR INSERT TO public WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_read_fraud_flags" ON public.fraud_flags;
CREATE POLICY "authenticated_read_fraud_flags" ON public.fraud_flags
FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_update_fraud_flags" ON public.fraud_flags;
CREATE POLICY "authenticated_update_fraud_flags" ON public.fraud_flags
FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- vote_fraud_logs: public insert, authenticated read
DROP POLICY IF EXISTS "public_insert_vote_fraud_logs" ON public.vote_fraud_logs;
CREATE POLICY "public_insert_vote_fraud_logs" ON public.vote_fraud_logs
FOR INSERT TO public WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_read_vote_fraud_logs" ON public.vote_fraud_logs;
CREATE POLICY "authenticated_read_vote_fraud_logs" ON public.vote_fraud_logs
FOR SELECT TO authenticated USING (true);
