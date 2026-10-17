-- Events social: event likes, organiser follows, organiser profiles, and the
-- event columns the mobile detail screen needs (banner, venue coordinates).
--
-- Spec: docs/superpowers/specs/2026-10-17-events-social-design.md (Data model).
-- ADDITIVE ONLY: CREATE ... IF NOT EXISTS and ADD COLUMN IF NOT EXISTS. No DROP,
-- no rename, no type narrowing, and no CHECK on public.events that could fail on
-- legacy rows. Likes and follows do not move money: no ledger, no idempotency key.

-- Likes: one row per (event, user). The PK makes a repeat like a no-op.
CREATE TABLE IF NOT EXISTS public.event_likes (
  event_id   uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

-- Follows: one row per (organiser, follower).
CREATE TABLE IF NOT EXISTS public.organiser_follows (
  organiser_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  follower_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organiser_id, follower_id)
);

-- Organiser profile, created lazily on first edit (or first follow).
CREATE TABLE IF NOT EXISTS public.organiser_profiles (
  organiser_id   uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name   text,
  bio            text NOT NULL DEFAULT '',
  banner_url     text,
  follower_count int  NOT NULL DEFAULT 0 CHECK (follower_count >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Event columns (all nullable or defaulted).
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS banner_url      text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS venue_lat       double precision;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS venue_lng       double precision;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS venue_place_id  text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS like_count      int NOT NULL DEFAULT 0;

-- Indexes.
-- Following feed: events of the organisers a user follows.
CREATE INDEX IF NOT EXISTS idx_organiser_follows_follower
  ON public.organiser_follows (follower_id);
-- idx_events_organiser covers only (organiser_id, state); the organiser page and
-- Following feed also order by starts_at, so add the three-column index.
CREATE INDEX IF NOT EXISTS idx_events_organiser_state_starts
  ON public.events (organiser_id, state, starts_at);

-- Row-level security. ENABLE only: do not FORCE, so the backend's owner-role
-- pool keeps working. Reads: any signed-in user. Writes: own rows only.
ALTER TABLE public.event_likes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organiser_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organiser_profiles ENABLE ROW LEVEL SECURITY;

-- Policies are created only when absent (re-runnable without a DROP).
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT * FROM (VALUES
      ('event_likes', 'event_likes_read', 'FOR SELECT TO authenticated USING (true)'),
      ('event_likes', 'event_likes_insert_own', 'FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid())'),
      ('event_likes', 'event_likes_delete_own', 'FOR DELETE TO authenticated USING (user_id = auth.uid())'),
      ('organiser_follows', 'organiser_follows_read', 'FOR SELECT TO authenticated USING (true)'),
      ('organiser_follows', 'organiser_follows_insert_own', 'FOR INSERT TO authenticated WITH CHECK (follower_id = auth.uid())'),
      ('organiser_follows', 'organiser_follows_delete_own', 'FOR DELETE TO authenticated USING (follower_id = auth.uid())'),
      ('organiser_profiles', 'organiser_profiles_read', 'FOR SELECT TO authenticated USING (true)'),
      ('organiser_profiles', 'organiser_profiles_insert_own', 'FOR INSERT TO authenticated WITH CHECK (organiser_id = auth.uid())'),
      ('organiser_profiles', 'organiser_profiles_update_own', 'FOR UPDATE TO authenticated USING (organiser_id = auth.uid()) WITH CHECK (organiser_id = auth.uid())')
    ) AS t(tbl, pol, body)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = p.tbl AND policyname = p.pol
    ) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I %s', p.pol, p.tbl, p.body);
    END IF;
  END LOOP;
END $$;

-- Counter protection (ruling R14). follower_count and like_count are written only
-- by the backend (service role / owner pool, one transaction per like or follow).
-- A signed-in user must not set them through PostgREST.
--
-- organiser_profiles: the default Supabase grant gives `authenticated` TABLE-level
-- INSERT/UPDATE, and a column-level REVOKE cannot subtract from a table-level
-- grant (it is a silent no-op). So revoke the table-level privileges and grant back
-- only the columns an organiser may write. follower_count is deliberately absent
-- from both lists; the column-level REVOKE is kept as an explicit statement of intent.
REVOKE INSERT, UPDATE ON public.organiser_profiles FROM authenticated;
GRANT INSERT (organiser_id, display_name, bio, banner_url, updated_at)
  ON public.organiser_profiles TO authenticated;
GRANT UPDATE (display_name, bio, banner_url, updated_at)
  ON public.organiser_profiles TO authenticated;
REVOKE UPDATE (follower_count) ON public.organiser_profiles FROM authenticated;

-- events: an organiser can already INSERT/UPDATE their own events rows through the
-- legacy events_insert / events_update policies (20260616240000_events.sql, TO
-- authenticated, organizer_id = auth.uid()), and `authenticated` holds table-level
-- privileges, so a column REVOKE would not bite. Narrowing the table grant would
-- need every other events column re-granted by name and could break existing
-- PostgREST writers. Instead pin like_count with a trigger that only affects the
-- PostgREST roles: it resets the value on INSERT and keeps the old value on UPDATE.
-- Service role / owner connections (the Go backend) are not affected.
CREATE OR REPLACE FUNCTION public.events_protect_like_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.like_count := 0;
    ELSE
      NEW.like_count := OLD.like_count;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_events_protect_like_count
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_protect_like_count();
