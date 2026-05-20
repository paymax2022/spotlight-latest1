-- ============================================================
-- Contestant Module Full Schema
-- Extends existing contestants table + adds media, votes tables
-- ============================================================

-- 1. Extend contestants table with new columns
ALTER TABLE public.contestants
  ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS social_instagram TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS social_twitter TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS social_facebook TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS voting_link TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS voting_link_slug TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_badge TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS total_votes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ranking INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- Unique index on voting_link_slug
CREATE UNIQUE INDEX IF NOT EXISTS idx_contestants_voting_link_slug
  ON public.contestants(voting_link_slug)
  WHERE voting_link_slug IS NOT NULL AND voting_link_slug != '';

-- Index on user_id
CREATE INDEX IF NOT EXISTS idx_contestants_user_id ON public.contestants(user_id);
CREATE INDEX IF NOT EXISTS idx_contestants_total_votes ON public.contestants(total_votes DESC);
CREATE INDEX IF NOT EXISTS idx_contestants_ranking ON public.contestants(ranking);

-- 2. Contestant Media Table
CREATE TABLE IF NOT EXISTS public.contestant_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contestant_id UUID NOT NULL REFERENCES public.contestants(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL DEFAULT 'image', -- image | video | audio
  file_url TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  file_size INTEGER DEFAULT 0,
  mime_type TEXT DEFAULT '',
  storage_path TEXT DEFAULT '',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  caption TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contestant_media_contestant_id ON public.contestant_media(contestant_id);
CREATE INDEX IF NOT EXISTS idx_contestant_media_type ON public.contestant_media(media_type);

-- 3. Contestant Votes Table
CREATE TABLE IF NOT EXISTS public.contestant_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contestant_id UUID NOT NULL REFERENCES public.contestants(id) ON DELETE CASCADE,
  contest_id UUID REFERENCES public.contests(id) ON DELETE CASCADE,
  voter_ip TEXT DEFAULT '',
  voter_fingerprint TEXT DEFAULT '',
  vote_type TEXT NOT NULL DEFAULT 'free', -- free | paid
  vote_count INTEGER NOT NULL DEFAULT 1,
  payment_reference TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contestant_votes_contestant_id ON public.contestant_votes(contestant_id);
CREATE INDEX IF NOT EXISTS idx_contestant_votes_contest_id ON public.contestant_votes(contest_id);
CREATE INDEX IF NOT EXISTS idx_contestant_votes_voter_ip ON public.contestant_votes(voter_ip);
CREATE INDEX IF NOT EXISTS idx_contestant_votes_created_at ON public.contestant_votes(created_at DESC);

-- 4. Functions

-- Updated_at trigger for contestant_media
CREATE OR REPLACE FUNCTION public.update_contestant_media_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_contestant_media_updated_at ON public.contestant_media;
CREATE TRIGGER set_contestant_media_updated_at
  BEFORE UPDATE ON public.contestant_media
  FOR EACH ROW EXECUTE FUNCTION public.update_contestant_media_updated_at();

-- Function to update contestant total_votes and ranking after vote insert
CREATE OR REPLACE FUNCTION public.update_contestant_vote_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Update total_votes for the contestant
  UPDATE public.contestants
  SET total_votes = (
    SELECT COALESCE(SUM(vote_count), 0)
    FROM public.contestant_votes
    WHERE contestant_id = NEW.contestant_id
  ),
  updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.contestant_id;

  -- Recalculate rankings within the same contest
  WITH ranked AS (
    SELECT id,
      RANK() OVER (
        PARTITION BY contest_id
        ORDER BY total_votes DESC
      ) AS new_rank
    FROM public.contestants
    WHERE contest_id = NEW.contest_id
      AND is_active = true
  )
  UPDATE public.contestants c
  SET ranking = ranked.new_rank
  FROM ranked
  WHERE c.id = ranked.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_vote_inserted ON public.contestant_votes;
CREATE TRIGGER on_vote_inserted
  AFTER INSERT ON public.contestant_votes
  FOR EACH ROW EXECUTE FUNCTION public.update_contestant_vote_stats();

-- Function to generate unique voting slug
CREATE OR REPLACE FUNCTION public.generate_voting_slug(contestant_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  counter INTEGER := 0;
BEGIN
  -- Create base slug from name
  base_slug := lower(regexp_replace(contestant_name, '[^a-zA-Z0-9\s]', '', 'g'));
  base_slug := regexp_replace(base_slug, '\s+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  final_slug := base_slug || '-' || substr(gen_random_uuid()::text, 1, 8);
  RETURN final_slug;
END;
$$;

-- 5. Enable RLS
ALTER TABLE public.contestant_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contestant_votes ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies for contestant_media
DROP POLICY IF EXISTS "public_read_contestant_media" ON public.contestant_media;
CREATE POLICY "public_read_contestant_media"
  ON public.contestant_media
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "authenticated_manage_contestant_media" ON public.contestant_media;
CREATE POLICY "authenticated_manage_contestant_media"
  ON public.contestant_media
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 7. RLS Policies for contestant_votes
DROP POLICY IF EXISTS "public_read_contestant_votes" ON public.contestant_votes;
CREATE POLICY "public_read_contestant_votes"
  ON public.contestant_votes
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "public_insert_contestant_votes" ON public.contestant_votes;
CREATE POLICY "public_insert_contestant_votes"
  ON public.contestant_votes
  FOR INSERT
  TO public
  WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_manage_contestant_votes" ON public.contestant_votes;
CREATE POLICY "authenticated_manage_contestant_votes"
  ON public.contestant_votes
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 8. Update existing contestants with voting slugs and links
DO $$
DECLARE
  rec RECORD;
  new_slug TEXT;
  site_url TEXT := 'https://spotlight1413.builtwithrocket.new';
BEGIN
  FOR rec IN SELECT id, name FROM public.contestants WHERE voting_link_slug = '' OR voting_link_slug IS NULL LOOP
    new_slug := lower(regexp_replace(rec.name, '[^a-zA-Z0-9\s]', '', 'g'));
    new_slug := regexp_replace(new_slug, '\s+', '-', 'g');
    new_slug := trim(both '-' from new_slug) || '-' || substr(gen_random_uuid()::text, 1, 8);
    UPDATE public.contestants
    SET
      voting_link_slug = new_slug,
      voting_link = site_url || '/vote/' || new_slug
    WHERE id = rec.id;
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Slug update failed: %', SQLERRM;
END $$;

-- 9. Sample media for existing contestants
DO $$
DECLARE
  c1 UUID;
  c2 UUID;
  c3 UUID;
BEGIN
  SELECT id INTO c1 FROM public.contestants ORDER BY created_at LIMIT 1;
  SELECT id INTO c2 FROM public.contestants ORDER BY created_at OFFSET 1 LIMIT 1;
  SELECT id INTO c3 FROM public.contestants ORDER BY created_at OFFSET 2 LIMIT 1;

  IF c1 IS NOT NULL THEN
    INSERT INTO public.contestant_media (id, contestant_id, media_type, file_url, file_name, is_primary, caption)
    VALUES
      (gen_random_uuid(), c1, 'image', 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=800&h=600&fit=crop', 'profile-photo.jpg', true, 'Main profile photo'),
      (gen_random_uuid(), c1, 'video', 'https://www.w3schools.com/html/mov_bbb.mp4', 'audition-reel.mp4', false, 'Audition performance reel')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF c2 IS NOT NULL THEN
    INSERT INTO public.contestant_media (id, contestant_id, media_type, file_url, file_name, is_primary, caption)
    VALUES
      (gen_random_uuid(), c2, 'image', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&h=600&fit=crop', 'profile-photo.jpg', true, 'Artist profile photo'),
      (gen_random_uuid(), c2, 'audio', 'https://www.w3schools.com/html/horse.ogg', 'music-sample.mp3', false, 'Original music sample')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF c3 IS NOT NULL THEN
    INSERT INTO public.contestant_media (id, contestant_id, media_type, file_url, file_name, is_primary, caption)
    VALUES
      (gen_random_uuid(), c3, 'image', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&h=600&fit=crop', 'profile-photo.jpg', true, 'Dance performance photo')
    ON CONFLICT (id) DO NOTHING;
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Sample media insertion failed: %', SQLERRM;
END $$;
