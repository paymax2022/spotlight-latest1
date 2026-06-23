-- ============================================================
-- Platform Enhancements Migration
-- Adds: celebrities, contest_prizes, contest_winners, admin_audit_logs
-- Extends: contests (voting config), contestants (winner fields)
-- ============================================================

-- 1. Extend contests table with voting configuration
ALTER TABLE public.contests
  ADD COLUMN IF NOT EXISTS voting_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voting_type TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS vote_price INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voting_start_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voting_end_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_votes_per_user INTEGER DEFAULT NULL;

-- 2. Extend contestants table with winner fields
ALTER TABLE public.contestants
  ADD COLUMN IF NOT EXISTS winner_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS is_disqualified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS disqualification_reason TEXT DEFAULT '';

-- 3. Celebrities table
CREATE TABLE IF NOT EXISTS public.celebrities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'supporter',
  image_url TEXT NOT NULL DEFAULT '',
  quote TEXT DEFAULT '',
  is_verified BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_celebrities_role ON public.celebrities(role);
CREATE INDEX IF NOT EXISTS idx_celebrities_display_order ON public.celebrities(display_order);

-- 4. Contest prizes table
CREATE TABLE IF NOT EXISTS public.contest_prizes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  value_ngn INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'NGN',
  position INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  awarded_to UUID REFERENCES public.contestants(id) ON DELETE SET NULL,
  awarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contest_prizes_contest_id ON public.contest_prizes(contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_prizes_status ON public.contest_prizes(status);

-- 5. Contest winners table
CREATE TABLE IF NOT EXISTS public.contest_winners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  contestant_id UUID NOT NULL REFERENCES public.contestants(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 1,
  total_votes INTEGER NOT NULL DEFAULT 0,
  announced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  announced_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  is_overridden BOOLEAN NOT NULL DEFAULT false,
  override_reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contest_winners_unique ON public.contest_winners(contest_id, position);
CREATE INDEX IF NOT EXISTS idx_contest_winners_contest_id ON public.contest_winners(contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_winners_contestant_id ON public.contest_winners(contestant_id);

-- 6. Admin audit logs table
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL DEFAULT '',
  target_table TEXT NOT NULL DEFAULT '',
  target_id UUID,
  old_value JSONB DEFAULT '{}',
  new_value JSONB DEFAULT '{}',
  reason TEXT DEFAULT '',
  ip_address TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_id ON public.admin_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action_type ON public.admin_audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON public.admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target_id ON public.admin_audit_logs(target_id);

-- 7. Updated_at trigger for contest_prizes
CREATE OR REPLACE FUNCTION public.update_contest_prizes_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_contest_prizes_updated_at ON public.contest_prizes;
CREATE TRIGGER set_contest_prizes_updated_at
  BEFORE UPDATE ON public.contest_prizes
  FOR EACH ROW EXECUTE FUNCTION public.update_contest_prizes_updated_at();

-- 8. Function to determine and announce winner
CREATE OR REPLACE FUNCTION public.determine_contest_winner(p_contest_id UUID, p_admin_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_winner RECORD;
  v_second RECORD;
  v_third RECORD;
  v_contest RECORD;
BEGIN
  SELECT * INTO v_contest FROM public.contests WHERE id = p_contest_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contest not found');
  END IF;

  -- Get top 3 contestants by votes
  SELECT id, name, total_votes, ranking INTO v_winner
  FROM public.contestants
  WHERE contest_id = p_contest_id AND is_active = true AND is_disqualified = false
  ORDER BY total_votes DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No eligible contestants found');
  END IF;

  -- Insert/update winner record for position 1
  INSERT INTO public.contest_winners (contest_id, contestant_id, position, total_votes, announced_by)
  VALUES (p_contest_id, v_winner.id, 1, v_winner.total_votes, p_admin_id)
  ON CONFLICT ON CONSTRAINT idx_contest_winners_unique
  DO UPDATE SET
    contestant_id = EXCLUDED.contestant_id,
    total_votes = EXCLUDED.total_votes,
    announced_at = CURRENT_TIMESTAMP,
    announced_by = EXCLUDED.announced_by;

  -- Update winner badge on contestant
  UPDATE public.contestants
  SET verification_badge = 'winner', winner_status = 'winner'
  WHERE id = v_winner.id;

  -- Get 2nd place
  SELECT id, name, total_votes INTO v_second
  FROM public.contestants
  WHERE contest_id = p_contest_id AND is_active = true AND is_disqualified = false AND id != v_winner.id
  ORDER BY total_votes DESC LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.contest_winners (contest_id, contestant_id, position, total_votes, announced_by)
    VALUES (p_contest_id, v_second.id, 2, v_second.total_votes, p_admin_id)
    ON CONFLICT ON CONSTRAINT idx_contest_winners_unique
    DO UPDATE SET contestant_id = EXCLUDED.contestant_id, total_votes = EXCLUDED.total_votes, announced_at = CURRENT_TIMESTAMP;
  END IF;

  -- Get 3rd place
  SELECT id, name, total_votes INTO v_third
  FROM public.contestants
  WHERE contest_id = p_contest_id AND is_active = true AND is_disqualified = false
    AND id NOT IN (v_winner.id, COALESCE(v_second.id, v_winner.id))
  ORDER BY total_votes DESC LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.contest_winners (contest_id, contestant_id, position, total_votes, announced_by)
    VALUES (p_contest_id, v_third.id, 3, v_third.total_votes, p_admin_id)
    ON CONFLICT ON CONSTRAINT idx_contest_winners_unique
    DO UPDATE SET contestant_id = EXCLUDED.contestant_id, total_votes = EXCLUDED.total_votes, announced_at = CURRENT_TIMESTAMP;
  END IF;

  -- Log the action
  INSERT INTO public.admin_audit_logs (admin_id, action_type, target_table, target_id, new_value, reason)
  VALUES (p_admin_id, 'announce_winner', 'contests', p_contest_id,
    jsonb_build_object('winner_id', v_winner.id, 'winner_name', v_winner.name, 'total_votes', v_winner.total_votes),
    'Automatic winner determination');

  RETURN jsonb_build_object('success', true, 'winner_id', v_winner.id, 'winner_name', v_winner.name, 'total_votes', v_winner.total_votes);
END;
$$;

-- 9. Enable RLS
ALTER TABLE public.celebrities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_prizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_winners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- 10. RLS Policies

-- Celebrities: public read
DROP POLICY IF EXISTS "public_read_celebrities" ON public.celebrities;
CREATE POLICY "public_read_celebrities"
ON public.celebrities FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "authenticated_manage_celebrities" ON public.celebrities;
CREATE POLICY "authenticated_manage_celebrities"
ON public.celebrities FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Contest prizes: public read
DROP POLICY IF EXISTS "public_read_contest_prizes" ON public.contest_prizes;
CREATE POLICY "public_read_contest_prizes"
ON public.contest_prizes FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "authenticated_manage_contest_prizes" ON public.contest_prizes;
CREATE POLICY "authenticated_manage_contest_prizes"
ON public.contest_prizes FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Contest winners: public read
DROP POLICY IF EXISTS "public_read_contest_winners" ON public.contest_winners;
CREATE POLICY "public_read_contest_winners"
ON public.contest_winners FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "authenticated_manage_contest_winners" ON public.contest_winners;
CREATE POLICY "authenticated_manage_contest_winners"
ON public.contest_winners FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Admin audit logs: authenticated read/write
DROP POLICY IF EXISTS "authenticated_manage_admin_audit_logs" ON public.admin_audit_logs;
CREATE POLICY "authenticated_manage_admin_audit_logs"
ON public.admin_audit_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 11. Seed celebrity data
DO $$
BEGIN
  INSERT INTO public.celebrities (name, title, role, image_url, quote, is_verified, display_order)
  VALUES
    ('Larry Gaaga', 'Music Executive & Patron', 'patron',
     'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop&crop=face',
     'Spotlight is the future of talent discovery in Africa. I am proud to back this platform.',
     true, 1),
    ('AY Makun', 'Comedian & Actor', 'supporter',
     'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop&crop=face',
     'This platform gives real talent a real chance. I wish I had this when I started.',
     true, 2),
    ('Reekado Banks', 'Afrobeats Artist', 'supporter',
     'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&h=400&fit=crop&crop=face',
     'The energy here is unmatched. Africa is watching and the world is next.',
     true, 3),
    ('2Baba', 'Legendary Music Icon', 'supporter',
     'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop&crop=face',
     'I have seen talent change lives. Spotlight is the bridge between raw talent and stardom.',
     true, 4),
    ('Charles Okocha', 'Actor & Entertainer', 'supporter',
     'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400&h=400&fit=crop&crop=face',
     'Spotlight is where dreams become reality. Support your favorite and watch them shine.',
     true, 5),
    ('Rudeboy', 'Afrobeats Superstar', 'supporter',
     'https://images.unsplash.com/photo-1463453091185-61582044d556?w=400&h=400&fit=crop&crop=face',
     'Vote for the talent you believe in. Your vote can change someone''s life forever.',
     true, 6),
    ('Adaeze Onuigbo', 'Lead Actress - To Kill a Monkey', 'actor',
     'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400&h=400&fit=crop&crop=face',
     'Talent is everywhere in Nigeria. Spotlight is the stage they deserve.',
     true, 7),
    ('Emeka Nwosu', 'Lead Actor - To Kill a Monkey', 'actor',
     'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=400&h=400&fit=crop&crop=face',
     'From the big screen to the biggest talent platform — Spotlight represents excellence.',
     true, 8),
      ('Bucci Franklin', 'Lead Actor - To Kill a Monkey', 'actor',
     'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=400&h=400&fit=crop&crop=face',
     'From the big screen to the biggest talent platform — Spotlight represents excellence.',
     true, 8)
  ON CONFLICT (id) DO NOTHING;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Celebrity seed failed: %', SQLERRM;
END $$;
