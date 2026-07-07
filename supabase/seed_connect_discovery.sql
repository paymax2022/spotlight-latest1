-- =============================================================================
-- Paymax Connect — Discovery seed (LOCAL DEV ONLY)
-- =============================================================================
-- Inserts 8 discoverable dating profiles so GET /api/v1/connect/discovery/stack
-- returns candidates for any logged-in viewer who has created their own profile
-- (finish Connect onboarding first). Each seed profile has:
--   • an auth.users row (email set — required by the handle_new_user trigger)
--   • a connect_profiles row (name, bio, dob→age, city, approximate Lagos geo)
--   • a VISIBLE 'dating' mode (connect_profile_modes) so it appears in the stack
--   • an approved photo (connect_profile_media)
--   • an l1-passed verification (shows the verified badge)
--
-- Idempotent: fixed UUIDs + ON CONFLICT / NOT EXISTS guards. Safe to re-run.
--
-- Apply against your LOCAL Supabase (port 54322), e.g.:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/seed_connect_discovery.sql
--
-- Remove later:
--   DELETE FROM auth.users WHERE email LIKE 'seed_%@connect.seed';   -- cascades to all seed rows
--
-- NOTE: the live backend ProfileCard returns name/city/verified/intent only (no
-- photo/age yet), so live cards will look sparse vs. the mock deck. Ask to enrich
-- the backend card if you want the live stack to show photos + age too.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  rec RECORD;
  v_profile_id uuid;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('a0000000-0000-4000-8000-000000000001'::uuid, 'Zainab',   27, 'Slow brunch, a gallery, then suya at night. Curious and kind.',            'Lagos',   6.4531, 3.3958, ARRAY['date','serious'],   'photo-1494790108377-be9c29b29330'),
      ('a0000000-0000-4000-8000-000000000002'::uuid, 'Tobi',     30, 'Go, coffee and long bike rides. Building fintech rails.',                  'Lagos',   6.6018, 3.3515, ARRAY['date'],             'photo-1500648767791-00dcc994a43e'),
      ('a0000000-0000-4000-8000-000000000003'::uuid, 'Amaka',    25, 'Paediatrics resident. Plant mum. Always down for live music.',             'Lagos',   6.5244, 3.3792, ARRAY['date','friendship'], 'photo-1534528741775-53994a69daeb'),
      ('a0000000-0000-4000-8000-000000000004'::uuid, 'Kelechi',  32, 'Early-stage founder. Tennis on weekends. Growing my network.',             'Lagos',   6.4281, 3.4219, ARRAY['date','network'],    'photo-1519085360753-af0119f7cbe7'),
      ('a0000000-0000-4000-8000-000000000005'::uuid, 'Ada',      28, 'Data scientist who paints. Sunday markets and jazz.',                      'Lagos',   6.4698, 3.5852, ARRAY['date'],             'photo-1517841905240-472988babdf9'),
      ('a0000000-0000-4000-8000-000000000006'::uuid, 'Emeka',    31, 'Architect. Amateur chef. Ask me about pepper soup.',                       'Lagos',   6.5795, 3.3211, ARRAY['date','serious'],   'photo-1506794778202-cad84cf45f1d'),
      ('a0000000-0000-4000-8000-000000000007'::uuid, 'Ngozi',    26, 'Nurse and marathoner. Big on kindness and follow-through.',                'Lagos',   6.4550, 3.3841, ARRAY['date'],             'photo-1524504388940-b1c1722653e1'),
      ('a0000000-0000-4000-8000-000000000008'::uuid, 'Seyi',     29, 'Music producer. Afrobeats and vinyl. Let''s find good food.',              'Lagos',   6.6059, 3.3491, ARRAY['date','friendship'], 'photo-1463453091185-61582044d556')
    ) AS t(uid, name, age, bio, city, lat, lng, tags, photo)
  LOOP
    -- 1. auth user (email is required by the handle_new_user trigger → user_profiles)
    INSERT INTO auth.users (id, email)
      VALUES (rec.uid, 'seed_' || left(rec.uid::text, 8) || '@connect.seed')
      ON CONFLICT (id) DO NOTHING;

    -- 2. profile (dob derived from age)
    INSERT INTO public.connect_profiles (user_id, display_name, bio, dob, city, geo_lat, geo_lng)
      VALUES (
        rec.uid, rec.name, rec.bio,
        (current_date - (rec.age || ' years')::interval)::date,
        rec.city, rec.lat, rec.lng
      )
      ON CONFLICT (user_id) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            bio          = EXCLUDED.bio,
            city         = EXCLUDED.city,
            geo_lat      = EXCLUDED.geo_lat,
            geo_lng      = EXCLUDED.geo_lng
      RETURNING id INTO v_profile_id;

    IF v_profile_id IS NULL THEN
      SELECT id INTO v_profile_id FROM public.connect_profiles WHERE user_id = rec.uid;
    END IF;

    -- 3. VISIBLE dating mode → makes the profile appear in the discovery stack
    INSERT INTO public.connect_profile_modes (profile_id, mode, visible, intent_tags)
      VALUES (v_profile_id, 'dating', true, rec.tags)
      ON CONFLICT (profile_id, mode) DO UPDATE
        SET visible = true, intent_tags = EXCLUDED.intent_tags;

    -- 4. approved photo (guard against duplicate rows on re-run)
    INSERT INTO public.connect_profile_media (profile_id, url, kind, moderation_status, moderated_at)
      SELECT v_profile_id,
             'https://images.unsplash.com/' || rec.photo || '?auto=format&fit=crop&w=800&q=60',
             'photo', 'approved', now()
      WHERE NOT EXISTS (
        SELECT 1 FROM public.connect_profile_media WHERE profile_id = v_profile_id
      );

    -- 5. verified badge (l1)
    INSERT INTO public.connect_verification (user_id, level, status, verified_at)
      VALUES (rec.uid, 'l1', 'l1_passed', now())
      ON CONFLICT (user_id) DO UPDATE
        SET level = 'l1', status = 'l1_passed', verified_at = now();
  END LOOP;

  RAISE NOTICE 'Connect discovery seed: 8 discoverable dating profiles ready.';
END $$;

COMMIT;
