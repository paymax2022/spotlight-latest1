-- Ensure contestant_status enum exists without mutating live tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'contestant_status'
  ) THEN
    CREATE TYPE public.contestant_status AS ENUM ('pending', 'approved', 'rejected', 'active', 'inactive');
  END IF;
END $$;

-- Create contestants table
CREATE TABLE IF NOT EXISTS public.contestants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  photo_url TEXT NOT NULL DEFAULT '',
  contest_link TEXT NOT NULL DEFAULT '',
  contest_id UUID REFERENCES public.contests(id) ON DELETE SET NULL,
  status public.contestant_status NOT NULL DEFAULT 'pending'::public.contestant_status,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contestants_contest_id ON public.contestants(contest_id);
CREATE INDEX IF NOT EXISTS idx_contestants_status ON public.contestants(status);
CREATE INDEX IF NOT EXISTS idx_contestants_category ON public.contestants(category);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_contestants_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_contestants_updated_at ON public.contestants;
CREATE TRIGGER set_contestants_updated_at
  BEFORE UPDATE ON public.contestants
  FOR EACH ROW EXECUTE FUNCTION public.update_contestants_updated_at();

-- Enable RLS
ALTER TABLE public.contestants ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "public_read_contestants" ON public.contestants;
CREATE POLICY "public_read_contestants"
  ON public.contestants
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "authenticated_manage_contestants" ON public.contestants;
CREATE POLICY "authenticated_manage_contestants"
  ON public.contestants
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Sample data
DO $$
DECLARE
  contest_id_1 UUID;
  contest_id_2 UUID;
BEGIN
  SELECT id INTO contest_id_1 FROM public.contests LIMIT 1;
  SELECT id INTO contest_id_2 FROM public.contests OFFSET 1 LIMIT 1;

  INSERT INTO public.contestants (id, name, category, bio, photo_url, contest_link, contest_id, status, is_active)
  VALUES
    (gen_random_uuid(), 'Amara Okafor', 'Acting', 'A passionate actress with 5 years of stage experience, trained at the Lagos Theatre Academy.', 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400&h=400&fit=crop', 'https://spotlight.ng/contestants/amara', contest_id_1, 'approved'::public.contestant_status, true),
    (gen_random_uuid(), 'Chidi Nwosu', 'Music', 'Afrobeats artist and songwriter from Enugu with a unique fusion of traditional and contemporary sounds.', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop', 'https://spotlight.ng/contestants/chidi', contest_id_1, 'approved'::public.contestant_status, true),
    (gen_random_uuid(), 'Fatima Bello', 'Dance', 'Contemporary dancer specializing in Afro-fusion choreography, trained in Lagos and Abuja.', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop', 'https://spotlight.ng/contestants/fatima', contest_id_2, 'pending'::public.contestant_status, true),
    (gen_random_uuid(), 'Emeka Eze', 'Comedy', 'Stand-up comedian and content creator with over 200k followers across social media platforms.', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop', 'https://spotlight.ng/contestants/emeka', contest_id_2, 'pending'::public.contestant_status, true),
    (gen_random_uuid(), 'Ngozi Adeyemi', 'Film', 'Award-winning short film director and cinematographer from Ibadan with 3 festival selections.', 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&h=400&fit=crop', 'https://spotlight.ng/contestants/ngozi', contest_id_1, 'rejected'::public.contestant_status, false),
    (gen_random_uuid(), 'Tunde Fashola', 'Directing', 'Emerging film director with a background in visual storytelling and documentary filmmaking.', 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop', 'https://spotlight.ng/contestants/tunde', contest_id_2, 'active'::public.contestant_status, true)
  ON CONFLICT (id) DO NOTHING;

EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Sample data insertion failed: %', SQLERRM;
END $$;
