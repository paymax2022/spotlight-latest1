-- ============================================================
-- Voting Engine Full Schema
-- Extends contestant_votes + adds vote tracking tables
-- ============================================================

-- 1. Extend contestant_votes with new columns for full voting engine
ALTER TABLE public.contestant_votes
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS device_fingerprint TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS referral_code TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS bonus_reason TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Index for user-based vote lookups
CREATE INDEX IF NOT EXISTS idx_contestant_votes_user_id ON public.contestant_votes(user_id);
CREATE INDEX IF NOT EXISTS idx_contestant_votes_vote_type ON public.contestant_votes(vote_type);
CREATE INDEX IF NOT EXISTS idx_contestant_votes_device ON public.contestant_votes(device_fingerprint);

-- 2. Vote Allocations Table (daily free vote tracking per user/device)
CREATE TABLE IF NOT EXISTS public.vote_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL DEFAULT '',
  contest_id UUID REFERENCES public.contests(id) ON DELETE CASCADE,
  contestant_id UUID REFERENCES public.contestants(id) ON DELETE CASCADE,
  vote_date DATE NOT NULL DEFAULT CURRENT_DATE,
  free_votes_used INTEGER NOT NULL DEFAULT 0,
  free_votes_limit INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vote_allocations_unique
  ON public.vote_allocations(COALESCE(user_id::text, ''), device_fingerprint, contestant_id, vote_date);

CREATE INDEX IF NOT EXISTS idx_vote_allocations_user_date ON public.vote_allocations(user_id, vote_date);
CREATE INDEX IF NOT EXISTS idx_vote_allocations_device_date ON public.vote_allocations(device_fingerprint, vote_date);
CREATE INDEX IF NOT EXISTS idx_vote_allocations_contestant ON public.vote_allocations(contestant_id);

-- 3. Referral Codes Table
CREATE TABLE IF NOT EXISTS public.referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  owner_contestant_id UUID REFERENCES public.contestants(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  bonus_votes_per_referral INTEGER NOT NULL DEFAULT 5,
  total_uses INTEGER NOT NULL DEFAULT 0,
  total_bonus_votes_awarded INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON public.referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_codes_contestant ON public.referral_codes(owner_contestant_id);

-- 4. Vote Packs Table (paid vote bundles)
CREATE TABLE IF NOT EXISTS public.vote_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  vote_count INTEGER NOT NULL DEFAULT 0,
  price_ngn INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Vote Pack Purchases Table
CREATE TABLE IF NOT EXISTS public.vote_pack_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  device_fingerprint TEXT DEFAULT '',
  pack_id UUID REFERENCES public.vote_packs(id) ON DELETE SET NULL,
  contestant_id UUID REFERENCES public.contestants(id) ON DELETE CASCADE,
  contest_id UUID REFERENCES public.contests(id) ON DELETE CASCADE,
  votes_purchased INTEGER NOT NULL DEFAULT 0,
  votes_used INTEGER NOT NULL DEFAULT 0,
  amount_paid_ngn INTEGER NOT NULL DEFAULT 0,
  payment_reference TEXT DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vote_pack_purchases_user ON public.vote_pack_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_vote_pack_purchases_contestant ON public.vote_pack_purchases(contestant_id);
CREATE INDEX IF NOT EXISTS idx_vote_pack_purchases_payment_ref ON public.vote_pack_purchases(payment_reference);

-- 6. Functions

-- Updated_at trigger for vote_allocations
CREATE OR REPLACE FUNCTION public.update_vote_allocations_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_vote_allocations_updated_at ON public.vote_allocations;
CREATE TRIGGER set_vote_allocations_updated_at
  BEFORE UPDATE ON public.vote_allocations
  FOR EACH ROW EXECUTE FUNCTION public.update_vote_allocations_updated_at();

-- Updated_at trigger for referral_codes
CREATE OR REPLACE FUNCTION public.update_referral_codes_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_referral_codes_updated_at ON public.referral_codes;
CREATE TRIGGER set_referral_codes_updated_at
  BEFORE UPDATE ON public.referral_codes
  FOR EACH ROW EXECUTE FUNCTION public.update_referral_codes_updated_at();

-- Updated_at trigger for vote_pack_purchases
CREATE OR REPLACE FUNCTION public.update_vote_pack_purchases_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_vote_pack_purchases_updated_at ON public.vote_pack_purchases;
CREATE TRIGGER set_vote_pack_purchases_updated_at
  BEFORE UPDATE ON public.vote_pack_purchases
  FOR EACH ROW EXECUTE FUNCTION public.update_vote_pack_purchases_updated_at();

-- Function: Check if free vote is allowed (daily limit per user/device)
CREATE OR REPLACE FUNCTION public.check_free_vote_allowed(
  p_user_id UUID,
  p_device_fingerprint TEXT,
  p_contestant_id UUID,
  p_vote_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_allocation RECORD;
  v_contest_status TEXT;
  v_contestant_status TEXT;
BEGIN
  -- Check contestant and contest status
  SELECT c.status, co.status
  INTO v_contestant_status, v_contest_status
  FROM public.contestants c
  LEFT JOIN public.contests co ON c.contest_id = co.id
  WHERE c.id = p_contestant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Contestant not found');
  END IF;

  IF v_contest_status = 'ended' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Contest has ended. Voting is locked.');
  END IF;

  IF v_contestant_status NOT IN ('active', 'approved') THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Contestant is not eligible for voting');
  END IF;

  -- Check daily allocation
  SELECT * INTO v_allocation
  FROM public.vote_allocations
  WHERE contestant_id = p_contestant_id
    AND vote_date = p_vote_date
    AND (
      (p_user_id IS NOT NULL AND user_id = p_user_id)
      OR (p_user_id IS NULL AND device_fingerprint = p_device_fingerprint)
    )
  LIMIT 1;

  IF FOUND AND v_allocation.free_votes_used >= v_allocation.free_votes_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'Daily free vote limit reached. Come back tomorrow or use paid votes.',
      'votes_used', v_allocation.free_votes_used,
      'votes_limit', v_allocation.free_votes_limit
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'votes_used', COALESCE(v_allocation.free_votes_used, 0),
    'votes_limit', COALESCE(v_allocation.free_votes_limit, 3),
    'votes_remaining', COALESCE(v_allocation.free_votes_limit, 3) - COALESCE(v_allocation.free_votes_used, 0)
  );
END;
$$;

-- Function: Cast a free vote
CREATE OR REPLACE FUNCTION public.cast_free_vote(
  p_contestant_id UUID,
  p_user_id UUID,
  p_device_fingerprint TEXT,
  p_voter_ip TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_check JSONB;
  v_contest_id UUID;
  v_vote_id UUID;
BEGIN
  -- Check if vote is allowed
  v_check := public.check_free_vote_allowed(p_user_id, p_device_fingerprint, p_contestant_id);

  IF NOT (v_check->>'allowed')::boolean THEN
    RETURN v_check;
  END IF;

  -- Get contest_id
  SELECT contest_id INTO v_contest_id FROM public.contestants WHERE id = p_contestant_id;

  -- Insert vote
  INSERT INTO public.contestant_votes (
    contestant_id, contest_id, user_id, voter_ip,
    voter_fingerprint, device_fingerprint, vote_type, vote_count
  ) VALUES (
    p_contestant_id, v_contest_id, p_user_id, p_voter_ip,
    p_device_fingerprint, p_device_fingerprint, 'free', 1
  )
  RETURNING id INTO v_vote_id;

  -- Upsert vote allocation
  INSERT INTO public.vote_allocations (
    user_id, device_fingerprint, contest_id, contestant_id,
    vote_date, free_votes_used, free_votes_limit
  ) VALUES (
    p_user_id, COALESCE(p_device_fingerprint, ''), v_contest_id, p_contestant_id,
    CURRENT_DATE, 1, 3
  )
  ON CONFLICT ON CONSTRAINT idx_vote_allocations_unique
  DO UPDATE SET
    free_votes_used = vote_allocations.free_votes_used + 1,
    updated_at = CURRENT_TIMESTAMP;

  RETURN jsonb_build_object(
    'success', true,
    'vote_id', v_vote_id,
    'vote_type', 'free',
    'message', 'Free vote cast successfully!'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'reason', SQLERRM);
END;
$$;

-- Function: Cast paid votes
CREATE OR REPLACE FUNCTION public.cast_paid_votes(
  p_contestant_id UUID,
  p_user_id UUID,
  p_device_fingerprint TEXT,
  p_vote_count INTEGER,
  p_payment_reference TEXT,
  p_voter_ip TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_contest_status TEXT;
  v_contestant_status TEXT;
  v_contest_id UUID;
  v_vote_id UUID;
BEGIN
  -- Check contestant and contest status
  SELECT c.status, co.status, c.contest_id
  INTO v_contestant_status, v_contest_status, v_contest_id
  FROM public.contestants c
  LEFT JOIN public.contests co ON c.contest_id = co.id
  WHERE c.id = p_contestant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Contestant not found');
  END IF;

  IF v_contest_status = 'ended' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Contest has ended. Voting is locked.');
  END IF;

  -- Insert paid vote
  INSERT INTO public.contestant_votes (
    contestant_id, contest_id, user_id, voter_ip,
    voter_fingerprint, device_fingerprint, vote_type, vote_count, payment_reference
  ) VALUES (
    p_contestant_id, v_contest_id, p_user_id, p_voter_ip,
    p_device_fingerprint, p_device_fingerprint, 'paid', p_vote_count, p_payment_reference
  )
  RETURNING id INTO v_vote_id;

  RETURN jsonb_build_object(
    'success', true,
    'vote_id', v_vote_id,
    'vote_type', 'paid',
    'votes_cast', p_vote_count,
    'message', 'Paid votes cast successfully!'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'reason', SQLERRM);
END;
$$;

-- Function: Cast referral votes
CREATE OR REPLACE FUNCTION public.cast_referral_vote(
  p_contestant_id UUID,
  p_referral_code TEXT,
  p_user_id UUID,
  p_device_fingerprint TEXT,
  p_voter_ip TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_referral RECORD;
  v_contest_id UUID;
  v_contest_status TEXT;
  v_vote_id UUID;
BEGIN
  -- Validate referral code
  SELECT * INTO v_referral
  FROM public.referral_codes
  WHERE code = p_referral_code AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Invalid or expired referral code');
  END IF;

  -- Check contest status
  SELECT c.contest_id, co.status
  INTO v_contest_id, v_contest_status
  FROM public.contestants c
  LEFT JOIN public.contests co ON c.contest_id = co.id
  WHERE c.id = p_contestant_id;

  IF v_contest_status = 'ended' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Contest has ended. Voting is locked.');
  END IF;

  -- Insert referral vote
  INSERT INTO public.contestant_votes (
    contestant_id, contest_id, user_id, voter_ip,
    voter_fingerprint, device_fingerprint, vote_type, vote_count, referral_code
  ) VALUES (
    p_contestant_id, v_contest_id, p_user_id, p_voter_ip,
    p_device_fingerprint, p_device_fingerprint, 'referral', v_referral.bonus_votes_per_referral, p_referral_code
  )
  RETURNING id INTO v_vote_id;

  -- Update referral code stats
  UPDATE public.referral_codes
  SET
    total_uses = total_uses + 1,
    total_bonus_votes_awarded = total_bonus_votes_awarded + v_referral.bonus_votes_per_referral,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = v_referral.id;

  RETURN jsonb_build_object(
    'success', true,
    'vote_id', v_vote_id,
    'vote_type', 'referral',
    'votes_cast', v_referral.bonus_votes_per_referral,
    'message', 'Referral votes applied successfully!'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'reason', SQLERRM);
END;
$$;

-- Function: Award bonus votes (admin)
CREATE OR REPLACE FUNCTION public.award_bonus_votes(
  p_contestant_id UUID,
  p_vote_count INTEGER,
  p_bonus_reason TEXT,
  p_awarded_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_contest_id UUID;
  v_vote_id UUID;
BEGIN
  SELECT contest_id INTO v_contest_id FROM public.contestants WHERE id = p_contestant_id;

  INSERT INTO public.contestant_votes (
    contestant_id, contest_id, user_id, vote_type, vote_count, bonus_reason
  ) VALUES (
    p_contestant_id, v_contest_id, p_awarded_by, 'bonus', p_vote_count, p_bonus_reason
  )
  RETURNING id INTO v_vote_id;

  RETURN jsonb_build_object(
    'success', true,
    'vote_id', v_vote_id,
    'vote_type', 'bonus',
    'votes_awarded', p_vote_count,
    'message', 'Bonus votes awarded successfully!'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'reason', SQLERRM);
END;
$$;

-- Function: Get vote history for a contestant
CREATE OR REPLACE FUNCTION public.get_vote_history(
  p_contestant_id UUID,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  vote_id UUID,
  vote_type TEXT,
  vote_count INTEGER,
  voter_ip TEXT,
  referral_code TEXT,
  bonus_reason TEXT,
  payment_reference TEXT,
  voted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cv.id AS vote_id,
    cv.vote_type,
    cv.vote_count,
    cv.voter_ip,
    cv.referral_code,
    cv.bonus_reason,
    cv.payment_reference,
    cv.created_at AS voted_at
  FROM public.contestant_votes cv
  WHERE cv.contestant_id = p_contestant_id
  ORDER BY cv.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Function: Get vote summary by type for a contestant
CREATE OR REPLACE FUNCTION public.get_vote_summary(p_contestant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_votes', COALESCE(SUM(vote_count), 0),
    'free_votes', COALESCE(SUM(CASE WHEN vote_type = 'free' THEN vote_count ELSE 0 END), 0),
    'paid_votes', COALESCE(SUM(CASE WHEN vote_type = 'paid' THEN vote_count ELSE 0 END), 0),
    'referral_votes', COALESCE(SUM(CASE WHEN vote_type = 'referral' THEN vote_count ELSE 0 END), 0),
    'bonus_votes', COALESCE(SUM(CASE WHEN vote_type = 'bonus' THEN vote_count ELSE 0 END), 0),
    'total_voters', COUNT(DISTINCT COALESCE(user_id::text, device_fingerprint)),
    'last_vote_at', MAX(created_at)
  )
  INTO v_result
  FROM public.contestant_votes
  WHERE contestant_id = p_contestant_id;

  RETURN v_result;
END;
$$;

-- 7. Enable RLS
ALTER TABLE public.vote_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vote_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vote_pack_purchases ENABLE ROW LEVEL SECURITY;

-- 8. RLS Policies

-- vote_allocations
DROP POLICY IF EXISTS "public_read_vote_allocations" ON public.vote_allocations;
CREATE POLICY "public_read_vote_allocations"
  ON public.vote_allocations FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "public_insert_vote_allocations" ON public.vote_allocations;
CREATE POLICY "public_insert_vote_allocations"
  ON public.vote_allocations FOR INSERT TO public WITH CHECK (true);

DROP POLICY IF EXISTS "public_update_vote_allocations" ON public.vote_allocations;
CREATE POLICY "public_update_vote_allocations"
  ON public.vote_allocations FOR UPDATE TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_manage_vote_allocations" ON public.vote_allocations;
CREATE POLICY "authenticated_manage_vote_allocations"
  ON public.vote_allocations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- referral_codes
DROP POLICY IF EXISTS "public_read_referral_codes" ON public.referral_codes;
CREATE POLICY "public_read_referral_codes"
  ON public.referral_codes FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "authenticated_manage_referral_codes" ON public.referral_codes;
CREATE POLICY "authenticated_manage_referral_codes"
  ON public.referral_codes FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- vote_packs
DROP POLICY IF EXISTS "public_read_vote_packs" ON public.vote_packs;
CREATE POLICY "public_read_vote_packs"
  ON public.vote_packs FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "authenticated_manage_vote_packs" ON public.vote_packs;
CREATE POLICY "authenticated_manage_vote_packs"
  ON public.vote_packs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- vote_pack_purchases
DROP POLICY IF EXISTS "public_read_vote_pack_purchases" ON public.vote_pack_purchases;
CREATE POLICY "public_read_vote_pack_purchases"
  ON public.vote_pack_purchases FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "public_insert_vote_pack_purchases" ON public.vote_pack_purchases;
CREATE POLICY "public_insert_vote_pack_purchases"
  ON public.vote_pack_purchases FOR INSERT TO public WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_manage_vote_pack_purchases" ON public.vote_pack_purchases;
CREATE POLICY "authenticated_manage_vote_pack_purchases"
  ON public.vote_pack_purchases FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 9. Seed default vote packs
DO $$
BEGIN
  INSERT INTO public.vote_packs (id, name, description, vote_count, price_ngn, is_active, sort_order)
  VALUES
    (gen_random_uuid(), 'Starter Pack', 'Perfect for showing your support', 10, 500, true, 1),
    (gen_random_uuid(), 'Power Pack', 'Give your favourite a big boost', 50, 2000, true, 2),
    (gen_random_uuid(), 'Champion Pack', 'Maximum votes for maximum impact', 150, 5000, true, 3)
  ON CONFLICT DO NOTHING;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Vote packs seed failed: %', SQLERRM;
END $$;

-- 10. Seed referral codes for existing contestants
DO $$
DECLARE
  rec RECORD;
  v_code TEXT;
BEGIN
  FOR rec IN SELECT id, name FROM public.contestants WHERE is_active = true LIMIT 6 LOOP
    v_code := upper(substr(regexp_replace(rec.name, '[^a-zA-Z0-9]', '', 'g'), 1, 4))
              || upper(substr(gen_random_uuid()::text, 1, 6));
    INSERT INTO public.referral_codes (id, code, owner_contestant_id, bonus_votes_per_referral, is_active)
    VALUES (gen_random_uuid(), v_code, rec.id, 5, true)
    ON CONFLICT (code) DO NOTHING;
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Referral codes seed failed: %', SQLERRM;
END $$;
