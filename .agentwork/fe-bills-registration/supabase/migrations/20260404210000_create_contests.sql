-- Contest Management Module
-- Creates contests table with full CRUD support and RLS policies

-- 1. Ensure contest_status enum exists without mutating live tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'contest_status'
  ) THEN
    CREATE TYPE public.contest_status AS ENUM ('draft', 'active', 'upcoming', 'ended');
  END IF;
END $$;

-- 2. Create contests table
CREATE TABLE IF NOT EXISTS public.contests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rules TEXT NOT NULL DEFAULT '',
  prize_pool TEXT NOT NULL DEFAULT '',
  judges TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status public.contest_status NOT NULL DEFAULT 'draft'::public.contest_status,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  category TEXT NOT NULL DEFAULT '',
  max_contestants INTEGER DEFAULT 0,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_contests_status ON public.contests(status);
CREATE INDEX IF NOT EXISTS idx_contests_created_at ON public.contests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contests_created_by ON public.contests(created_by);

-- 4. Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_contests_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

-- 5. Enable RLS
ALTER TABLE public.contests ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies
-- Public can read all contests
DROP POLICY IF EXISTS "public_read_contests" ON public.contests;
CREATE POLICY "public_read_contests"
ON public.contests
FOR SELECT
TO public
USING (true);

-- Authenticated users can insert contests
DROP POLICY IF EXISTS "authenticated_insert_contests" ON public.contests;
CREATE POLICY "authenticated_insert_contests"
ON public.contests
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Authenticated users can update contests
DROP POLICY IF EXISTS "authenticated_update_contests" ON public.contests;
CREATE POLICY "authenticated_update_contests"
ON public.contests
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Authenticated users can delete contests
DROP POLICY IF EXISTS "authenticated_delete_contests" ON public.contests;
CREATE POLICY "authenticated_delete_contests"
ON public.contests
FOR DELETE
TO authenticated
USING (true);

-- 7. Trigger for updated_at
DROP TRIGGER IF EXISTS contests_updated_at ON public.contests;
CREATE TRIGGER contests_updated_at
  BEFORE UPDATE ON public.contests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_contests_updated_at();

-- 8. Sample contest data
DO $$
BEGIN
  INSERT INTO public.contests (id, name, description, rules, prize_pool, judges, status, start_date, end_date, category, max_contestants)
  VALUES
    (
      gen_random_uuid(),
      'Best Emerging Actor 2025',
      'A prestigious competition to discover the next generation of acting talent in Nigeria. Open to all aspiring actors aged 18-35.',
      '1. Contestants must be Nigerian citizens or residents. 2. Age limit: 18-35 years. 3. Submission must include a 3-minute performance video. 4. Judges decision is final. 5. No plagiarism allowed.',
      '₦500,000',
      ARRAY['Genevieve Nnaji', 'RMD', 'Funke Akindele'],
      'active'::public.contest_status,
      NOW() - INTERVAL '5 days',
      NOW() + INTERVAL '25 days',
      'Acting',
      100
    ),
    (
      gen_random_uuid(),
      'Nollywood Rising Star',
      'Find the next big Nollywood star. This competition is open to all aspiring film actors ready to make their mark in the industry.',
      '1. Open to all Nigerian residents. 2. Must submit a 5-minute short film clip. 3. Voting is open to the public. 4. Top 10 finalists will be invited for a live audition. 5. Prize includes a film role.',
      '₦750,000',
      ARRAY['Omotola Jalade', 'John Okafor', 'Ini Edo'],
      'active'::public.contest_status,
      NOW() - INTERVAL '2 days',
      NOW() + INTERVAL '30 days',
      'Film',
      150
    ),
    (
      gen_random_uuid(),
      'Spotlight Talent Search Season 2',
      'The biggest talent search in Nigeria returns for Season 2. Showcase your unique talent and win life-changing prizes.',
      '1. Open to all talents aged 16 and above. 2. Categories: Singing, Dancing, Comedy, Acting. 3. Public voting counts for 60% of final score. 4. Judges panel accounts for 40%. 5. Grand finale will be held live.',
      '₦1,000,000',
      ARRAY['2Baba', 'Tiwa Savage', 'Don Jazzy'],
      'upcoming'::public.contest_status,
      NOW() + INTERVAL '7 days',
      NOW() + INTERVAL '60 days',
      'Talent',
      200
    ),
    (
      gen_random_uuid(),
      'Comedy Skit Creator Award',
      'Celebrate the best comedy content creators in Nigeria. Submit your best skit and let the public decide.',
      '1. Skit must be original content. 2. Maximum duration: 5 minutes. 3. Must be family-friendly. 4. No hate speech or offensive content. 5. Winner gets a brand deal package.',
      '₦200,000',
      ARRAY['Basketmouth', 'AY Makun', 'Bovi'],
      'ended'::public.contest_status,
      NOW() - INTERVAL '60 days',
      NOW() - INTERVAL '5 days',
      'Comedy',
      80
    )
  ON CONFLICT (id) DO NOTHING;
END $$;
