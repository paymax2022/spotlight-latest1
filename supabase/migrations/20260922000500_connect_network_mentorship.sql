-- Paymax Connect — Phase 6G/6H: Professional Mentorship + Loyalty wiring.
-- Ref: docs/connect/PAYMAX-CONNECT-PHASE6-PROFESSIONAL-NETWORK.md §4 (Mentorship
--      Match state machine), §6.6 (MN-01..MN-06), §8 (loyalty events / ADM-*).
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX/POLICY IF NOT EXISTS, idempotent seeds
--   (ON CONFLICT DO NOTHING). NO DROP TABLE/COLUMN/TYPE, NO RENAME, NO type
--   narrowing. `DROP POLICY IF EXISTS` is used ONLY to (re)create RLS policies
--   idempotently (established Connect module pattern). Safe to re-run.
--
-- This migration adds:
--   (a) connect_mentorship_profiles — opt-in mentor/mentee capability record (PN-9:
--       self-opt-in, no approval gate). Discovery reads ONLY these + professional
--       fields; it NEVER joins Dating-mode profile columns (PN-7 mode-privacy).
--   (b) connect_mentorship_matches  — guarded mentorship FSM (§4).
--   (c) connect_networking_loyalty_log — APPEND-ONLY AUDIT log of Phase-6 Paymax
--       Black emissions (PN-8). This is NOT a second currency: the currency stays
--       the loyalty/points ledger (loyalty.AwardFor). This table only records that
--       an emit happened, so ADM-GM-01 can trace a grant to its mentorship source
--       without a cross-package read of the points ledger.
--   (d) No new permission seed — admin surfaces reuse connect.moderation.manage
--       (seeded in 20260920000400_rbac_seed_gaps_round2.sql). Member mentorship is
--       self-opt-in (PN-9), so no member permission gate is required.
--
-- Reuses helpers from prior migrations: public.handle_updated_at(), public.is_admin().
-- RLS on every new table; service_role bypass (the backend writes via service role).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- (a) connect_mentorship_profiles — opt-in capability (MN-01).
--     role is mentor | mentee | both; domains[] drives MN-02 filtering; capacity
--     bounds concurrent mentees. user_id is uuid REFERENCES auth.users to mirror
--     connect_professional_profiles (the safe join target for discovery, PN-7).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.connect_mentorship_profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'both'
                CHECK (role IN ('mentor','mentee','both')),
  domains     text[] NOT NULL DEFAULT '{}'::text[],
  capacity    int NOT NULL DEFAULT 1,
  active       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
-- Partial index over discoverable mentors (role can mentor + active) for MN-02.
CREATE INDEX IF NOT EXISTS idx_connect_mentorship_discoverable
  ON public.connect_mentorship_profiles (role)
  WHERE active AND role IN ('mentor','both');
CREATE INDEX IF NOT EXISTS idx_connect_mentorship_domains
  ON public.connect_mentorship_profiles USING gin (domains);

-- ════════════════════════════════════════════════════════════════════════════
-- (b) connect_mentorship_matches — guarded FSM (§4):
--       REQUESTED → ACCEPTED | DECLINED
--       ACCEPTED  → ACTIVE ⇄ PAUSED → COMPLETED | ENDED_EARLY
--     The DB CHECK bounds the value domain; the Go service layer enforces the
--     legal transitions (deny-by-default). One row per (mentor,mentee) pair
--     mirrors connect_intro_requests, giving natural idempotency on re-request.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.connect_mentorship_matches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mentee_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state       text NOT NULL DEFAULT 'requested'
                CHECK (state IN ('requested','accepted','declined',
                                 'active','paused','completed','ended_early')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (mentor_id <> mentee_id),
  UNIQUE (mentor_id, mentee_id)
);
CREATE INDEX IF NOT EXISTS idx_connect_mentorship_matches_mentor
  ON public.connect_mentorship_matches (mentor_id, state);
CREATE INDEX IF NOT EXISTS idx_connect_mentorship_matches_mentee
  ON public.connect_mentorship_matches (mentee_id, state);

-- ════════════════════════════════════════════════════════════════════════════
-- (c) connect_networking_loyalty_log — APPEND-ONLY AUDIT of Phase-6 loyalty emits
--     (PN-8 / ADM-GM-01). reference is the SAME idempotency reference passed to
--     loyalty.AwardFor, so UNIQUE(reference) makes each emit-record write a no-op
--     on replay — mirroring the points-ledger idempotency exactly. NOT a currency:
--     it stores no balance and no points column.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.connect_networking_loyalty_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module      text NOT NULL DEFAULT 'connect',
  trigger     text NOT NULL,
  reference   text NOT NULL UNIQUE,
  match_id    uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_networking_loyalty_user
  ON public.connect_networking_loyalty_log (user_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers (reuse generic public.handle_updated_at).
-- The loyalty log is append-only, so it takes no updated_at trigger.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'connect_mentorship_profiles','connect_mentorship_matches'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated ON public.%1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON public.%1$s '
      'FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()', t);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — deny-by-default; service_role bypass on every table.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.connect_mentorship_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_mentorship_matches      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_networking_loyalty_log  ENABLE ROW LEVEL SECURITY;

-- mentorship profiles: owner manages own; active profiles are discovery-readable
-- (PN-7: only these mentorship/professional columns are ever exposed); admin all.
DROP POLICY IF EXISTS connect_mentorship_profiles_owner ON public.connect_mentorship_profiles;
CREATE POLICY connect_mentorship_profiles_owner ON public.connect_mentorship_profiles
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS connect_mentorship_profiles_read ON public.connect_mentorship_profiles;
CREATE POLICY connect_mentorship_profiles_read ON public.connect_mentorship_profiles
  FOR SELECT TO authenticated USING (active OR public.is_admin());
DROP POLICY IF EXISTS connect_mentorship_profiles_service ON public.connect_mentorship_profiles;
CREATE POLICY connect_mentorship_profiles_service ON public.connect_mentorship_profiles
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- matches: either participant reads own; state writes flow through the service role
-- (the guarded FSM + loyalty emit run server-side, never client-direct).
DROP POLICY IF EXISTS connect_mentorship_matches_party ON public.connect_mentorship_matches;
CREATE POLICY connect_mentorship_matches_party ON public.connect_mentorship_matches
  FOR SELECT TO authenticated
  USING (mentor_id = auth.uid() OR mentee_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_mentorship_matches_service ON public.connect_mentorship_matches;
CREATE POLICY connect_mentorship_matches_service ON public.connect_mentorship_matches
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- loyalty log: owner reads own; admin reads all (ADM-GM-01); writes service-only.
DROP POLICY IF EXISTS connect_networking_loyalty_own ON public.connect_networking_loyalty_log;
CREATE POLICY connect_networking_loyalty_own ON public.connect_networking_loyalty_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_networking_loyalty_service ON public.connect_networking_loyalty_log;
CREATE POLICY connect_networking_loyalty_service ON public.connect_networking_loyalty_log
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- Loyalty earn-rule binding (PN-8): map (module='connect', trigger=
-- 'mentorship_complete') to a Paymax Black earn rule so loyalty.AwardFor resolves
-- an active binding. Idempotent seeds; a no-op if the loyalty tables/rule are
-- absent in this environment (AwardFor silently no-ops on a missing binding).
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.points_earn_rules (rule_key, module, version, points_fixed, points_per_kobo, expiry_days, active)
VALUES ('connect.mentorship_complete', 'connect', 1, 200, 0, 0, true)
ON CONFLICT DO NOTHING;

INSERT INTO public.loyalty_earn_rules (module, trigger, rule_key, active)
VALUES ('connect', 'mentorship_complete', 'connect.mentorship_complete', true)
ON CONFLICT DO NOTHING;

COMMIT;
