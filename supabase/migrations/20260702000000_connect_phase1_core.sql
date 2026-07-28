-- Paymax Connect — Phase 1 core (profiles / verification L0–L1 / matching / discovery / search)
-- Ref: docs/prd/dating/{data-model.md §Phase 1, api.md §Phase 1, compliance.md, acceptance.md §Phase 1}
--
-- Additive-only: CREATE TABLE/INDEX IF NOT EXISTS, idempotent DROP POLICY ... CREATE POLICY,
-- ON CONFLICT DO NOTHING seeds. No existing table is altered, no column dropped/renamed/narrowed.
-- Reuses helpers from prior migrations: public.is_admin(), public.handle_updated_at().
-- All FKs to auth.users(id) per the canonical repo pattern. RLS on every table; service_role bypass.
--
-- Safety invariants enforced at the data layer (backstop to the service layer):
--   * Per-mode visibility lives in connect_profile_modes (independent per mode).
--   * Likes are idempotent via UNIQUE(from_profile,to_profile).
--   * Matches are mutual-only: ordered pair with CHECK(profile_a < profile_b) + UNIQUE.
--   * Verification PII never stored plaintext: only evidence_ref (encrypted/opaque) + reason_code.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. connect_profiles — one identity profile per user. dob never exposed raw.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_profiles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  bio          text,
  dob          date,                          -- age-gate source; never returned raw to peers
  city         text,
  -- Coarse, privacy-preserving geo. Exact coords are NOT stored here in Phase 1;
  -- search distance is computed against these bucketed centroid columns only.
  geo_lat      double precision,              -- approximate (centroid) latitude
  geo_lng      double precision,              -- approximate (centroid) longitude
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_profiles_user ON public.connect_profiles (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. connect_profile_modes — independent per-mode visibility / intent / privacy
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_profile_modes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES public.connect_profiles(id) ON DELETE CASCADE,
  mode        text NOT NULL
                CHECK (mode IN ('dating','friendship','professional','creator','event')),
  visible     boolean NOT NULL DEFAULT false,           -- off by default; user opts in per mode
  intent_tags text[] NOT NULL DEFAULT '{}',
  privacy     jsonb  NOT NULL DEFAULT '{"location":"approximate"}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, mode)
);
CREATE INDEX IF NOT EXISTS idx_connect_profile_modes_visible
  ON public.connect_profile_modes (mode, visible);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. connect_profile_media — not public until moderated (status starts 'pending')
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_profile_media (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        uuid NOT NULL REFERENCES public.connect_profiles(id) ON DELETE CASCADE,
  url               text NOT NULL,
  kind              text NOT NULL DEFAULT 'photo' CHECK (kind IN ('photo','clip')),
  moderation_status text NOT NULL DEFAULT 'pending'
                      CHECK (moderation_status IN ('pending','approved','rejected')),
  moderated_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_profile_media_profile
  ON public.connect_profile_media (profile_id, moderation_status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. connect_verification — L0–L1 selfie/liveness state + badge.
--    evidence_ref is encrypted/opaque; raw biometric payloads are never stored here.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_verification (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  level        text NOT NULL DEFAULT 'l0' CHECK (level IN ('l0','l1')),
  status       text NOT NULL DEFAULT 'none'
                 CHECK (status IN ('none','pending','l0_passed','l1_passed','failed','rejected')),
  evidence_ref text,                          -- encrypted/opaque provider reference; NEVER plaintext PII
  reason_code  text,
  provider     text,
  verified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_verification_status
  ON public.connect_verification (status, updated_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. connect_likes — unidirectional interest / super-like. Idempotent by UNIQUE.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_likes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_profile uuid NOT NULL REFERENCES public.connect_profiles(id) ON DELETE CASCADE,
  to_profile   uuid NOT NULL REFERENCES public.connect_profiles(id) ON DELETE CASCADE,
  kind         text NOT NULL DEFAULT 'like' CHECK (kind IN ('like','super')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (from_profile <> to_profile),
  UNIQUE (from_profile, to_profile)           -- idempotency backstop: one row per (from,to)
);
CREATE INDEX IF NOT EXISTS idx_connect_likes_to   ON public.connect_likes (to_profile);
CREATE INDEX IF NOT EXISTS idx_connect_likes_from ON public.connect_likes (from_profile, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. connect_matches — mutual match only. Ordered pair (a<b) keeps it canonical.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_matches (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_a  uuid NOT NULL REFERENCES public.connect_profiles(id) ON DELETE CASCADE,
  profile_b  uuid NOT NULL REFERENCES public.connect_profiles(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'matched'
               CHECK (status IN ('matched','unmatched','blocked')),
  reason     jsonb,                           -- match-reason card payload (shared/intent/distance)
  matched_at timestamptz NOT NULL DEFAULT now(),
  CHECK (profile_a < profile_b),              -- canonical ordering: no dup pair in either direction
  UNIQUE (profile_a, profile_b)
);
CREATE INDEX IF NOT EXISTS idx_connect_matches_a ON public.connect_matches (profile_a, status);
CREATE INDEX IF NOT EXISTS idx_connect_matches_b ON public.connect_matches (profile_b, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. connect_daily_match_sets — anti-fatigue daily curation log (limit from config)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_daily_match_sets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES public.connect_profiles(id) ON DELETE CASCADE,
  for_date    date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  candidates  jsonb NOT NULL DEFAULT '[]'::jsonb,   -- ordered candidate profile ids + reasons
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, for_date)               -- one curated set per user per day
);
CREATE INDEX IF NOT EXISTS idx_connect_daily_match_sets_profile
  ON public.connect_daily_match_sets (profile_id, for_date DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. updated_at triggers (reuse generic public.handle_updated_at)
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_connect_profiles_updated ON public.connect_profiles;
CREATE TRIGGER trg_connect_profiles_updated
  BEFORE UPDATE ON public.connect_profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_connect_profile_modes_updated ON public.connect_profile_modes;
CREATE TRIGGER trg_connect_profile_modes_updated
  BEFORE UPDATE ON public.connect_profile_modes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_connect_verification_updated ON public.connect_verification;
CREATE TRIGGER trg_connect_verification_updated
  BEFORE UPDATE ON public.connect_verification
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.connect_profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_profile_modes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_profile_media    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_verification     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_likes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_matches          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_daily_match_sets ENABLE ROW LEVEL SECURITY;

-- connect_profiles: a user reads/writes only their own row; admins read all; service bypass.
-- (Cross-user discovery/search reads run through the service-role backend, which applies
--  per-mode visibility in SQL — peers never get blanket SELECT on the raw table.)
DROP POLICY IF EXISTS connect_profiles_self ON public.connect_profiles;
CREATE POLICY connect_profiles_self ON public.connect_profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS connect_profiles_service ON public.connect_profiles;
CREATE POLICY connect_profiles_service ON public.connect_profiles
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- connect_profile_modes: owner manages own modes; admins read; service bypass.
DROP POLICY IF EXISTS connect_profile_modes_self ON public.connect_profile_modes;
CREATE POLICY connect_profile_modes_self ON public.connect_profile_modes
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.connect_profiles p
                 WHERE p.id = connect_profile_modes.profile_id
                   AND (p.user_id = auth.uid() OR public.is_admin())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.connect_profiles p
                      WHERE p.id = connect_profile_modes.profile_id
                        AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS connect_profile_modes_service ON public.connect_profile_modes;
CREATE POLICY connect_profile_modes_service ON public.connect_profile_modes
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- connect_profile_media: owner sees own (any status); others see ONLY approved (invariant 9);
-- admins see all; service bypass.
DROP POLICY IF EXISTS connect_profile_media_read ON public.connect_profile_media;
CREATE POLICY connect_profile_media_read ON public.connect_profile_media
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM public.connect_profiles p
               WHERE p.id = connect_profile_media.profile_id AND p.user_id = auth.uid())
    OR moderation_status = 'approved'
  );

DROP POLICY IF EXISTS connect_profile_media_owner_write ON public.connect_profile_media;
CREATE POLICY connect_profile_media_owner_write ON public.connect_profile_media
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.connect_profiles p
                      WHERE p.id = connect_profile_media.profile_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS connect_profile_media_service ON public.connect_profile_media;
CREATE POLICY connect_profile_media_service ON public.connect_profile_media
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- connect_verification: user reads own status; admins read all; ONLY service_role writes
-- (encrypted evidence handling stays backend-side). No authenticated write policy.
DROP POLICY IF EXISTS connect_verification_self_read ON public.connect_verification;
CREATE POLICY connect_verification_self_read ON public.connect_verification
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS connect_verification_service ON public.connect_verification;
CREATE POLICY connect_verification_service ON public.connect_verification
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- connect_likes: actor sees/creates own likes; service bypass. No one reads who liked them
-- directly (that surfaces only as a mutual match).
DROP POLICY IF EXISTS connect_likes_self ON public.connect_likes;
CREATE POLICY connect_likes_self ON public.connect_likes
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.connect_profiles p
                 WHERE p.id = connect_likes.from_profile AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.connect_profiles p
                      WHERE p.id = connect_likes.from_profile AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS connect_likes_service ON public.connect_likes;
CREATE POLICY connect_likes_service ON public.connect_likes
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- connect_matches: a participant reads their matches; admins read all; ONLY service_role writes
-- (a match is created server-side after the mutual-like check). No authenticated write policy.
DROP POLICY IF EXISTS connect_matches_participant_read ON public.connect_matches;
CREATE POLICY connect_matches_participant_read ON public.connect_matches
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM public.connect_profiles p
               WHERE p.id IN (connect_matches.profile_a, connect_matches.profile_b)
                 AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS connect_matches_service ON public.connect_matches;
CREATE POLICY connect_matches_service ON public.connect_matches
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- connect_daily_match_sets: owner reads own curated set; service writes.
DROP POLICY IF EXISTS connect_daily_match_sets_self ON public.connect_daily_match_sets;
CREATE POLICY connect_daily_match_sets_self ON public.connect_daily_match_sets
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.connect_profiles p
                 WHERE p.id = connect_daily_match_sets.profile_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS connect_daily_match_sets_service ON public.connect_daily_match_sets;
CREATE POLICY connect_daily_match_sets_service ON public.connect_daily_match_sets
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Seed Phase-1 config knobs (idempotent). Sub-feature tunables stay backend-owned.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.connect_config (key, value, scope, visibility, description) VALUES
  ('search.distance_buckets_km',
     '[5,10,25,50,100]'::jsonb, 'global', 'public',
     'Approximate, privacy-preserving distance buckets (km) used in search/discovery'),
  ('discovery.match_reason_weights',
     '{"shared_intent":0.4,"distance":0.3,"verification":0.3}'::jsonb, 'global', 'internal',
     'Weights used to rank curated daily candidates and build match-reason cards'),
  ('verification.badge_min_level',
     '"l1"'::jsonb, 'global', 'public',
     'Minimum verification level that earns the verified badge on a profile')
ON CONFLICT (key) DO NOTHING;

COMMIT;
