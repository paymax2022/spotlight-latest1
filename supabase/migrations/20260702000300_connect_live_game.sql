-- Paymax Connect — Live streaming + Gamification
-- Ref: docs/prd/dating/connect/connect-paymax-prd.md §6.2 (live 1:many, co-host,
--      PK battles, low-bandwidth) and §6.5 (XP, missions, streaks, leaderboards,
--      seasons). docs/prd/dating/CLAUDE.md: XP/coins are NON-CASH points — never
--      money, never the finance ledger, no conversion path.
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX/POLICY IF NOT EXISTS, idempotent seeds. No
-- existing table is modified. No DROP TABLE/COLUMN/TYPE, no RENAME, no type
-- narrowing. (DROP POLICY IF EXISTS is used only to keep policy creation
-- idempotent, immediately followed by CREATE — no schema is dropped.)
--
-- NON-CASH: point columns are BIGINT but clearly named points/xp/coins/score.
-- They live in their own connect_* tables and are NEVER posted to ledger_entries.
--
-- Reused helpers: public.is_admin(), public.handle_updated_at(). FKs → auth.users(id).
-- RLS on every table with a service_role bypass policy.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- LIVE STREAMING (PRD §6.2)
-- ════════════════════════════════════════════════════════════════════════════

-- A single live broadcast (1:many). viewer_count is a cached projection of active
-- participants; low_bandwidth toggles the low-data ingest/playback path.
CREATE TABLE IF NOT EXISTS public.connect_live_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  topic         text,
  status        text NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled','live','ended','terminated')),
  low_bandwidth boolean NOT NULL DEFAULT false,
  viewer_count  integer NOT NULL DEFAULT 0 CHECK (viewer_count >= 0),
  max_cohosts   integer NOT NULL DEFAULT 3 CHECK (max_cohosts >= 0),
  started_at    timestamptz,
  ended_at      timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_live_sessions_live
  ON public.connect_live_sessions (status, viewer_count DESC) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS idx_connect_live_sessions_host
  ON public.connect_live_sessions (host_id, created_at DESC);

-- Viewers + co-hosts attached to a session. role/state drive moderation.
CREATE TABLE IF NOT EXISTS public.connect_live_participants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.connect_live_sessions(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'viewer' CHECK (role IN ('host','cohost','viewer')),
  state      text NOT NULL DEFAULT 'active'
               CHECK (state IN ('invited','active','muted','kicked','left')),
  joined_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_connect_live_participants_session
  ON public.connect_live_participants (session_id, state);

-- Head-to-head PK battle between two live sessions. host_score/opponent_score are
-- NON-CASH gamification counters (BIGINT points) — NOT money.
CREATE TABLE IF NOT EXISTS public.connect_pk_battles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid NOT NULL REFERENCES public.connect_live_sessions(id) ON DELETE CASCADE,
  opponent_session_id uuid NOT NULL REFERENCES public.connect_live_sessions(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  host_score          bigint NOT NULL DEFAULT 0 CHECK (host_score >= 0),     -- NON-CASH points
  opponent_score      bigint NOT NULL DEFAULT 0 CHECK (opponent_score >= 0), -- NON-CASH points
  started_at          timestamptz NOT NULL DEFAULT now(),
  ended_at            timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (session_id <> opponent_session_id)
);
CREATE INDEX IF NOT EXISTS idx_connect_pk_battles_session
  ON public.connect_pk_battles (session_id, status);

-- ════════════════════════════════════════════════════════════════════════════
-- GAMIFICATION (PRD §6.5) — NON-CASH points only
-- ════════════════════════════════════════════════════════════════════════════

-- Immutable, idempotent XP grants. event_key UNIQUE makes a retried award a no-op
-- (XP is never double-counted). xp is NON-CASH points (BIGINT), NOT money.
CREATE TABLE IF NOT EXISTS public.connect_xp_ledger (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_key  text NOT NULL,
  source     text,
  xp         bigint NOT NULL CHECK (xp > 0),  -- NON-CASH points
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_key)
);
CREATE INDEX IF NOT EXISTS idx_connect_xp_ledger_user
  ON public.connect_xp_ledger (user_id, created_at DESC);

-- Backend-owned mission definitions. reward_xp / reward_coins are NON-CASH points.
CREATE TABLE IF NOT EXISTS public.connect_missions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,
  title        text NOT NULL,
  cadence      text NOT NULL DEFAULT 'daily'
                 CHECK (cadence IN ('daily','weekly','season','once')),
  target       integer NOT NULL DEFAULT 1 CHECK (target >= 1),
  reward_xp    bigint NOT NULL DEFAULT 0 CHECK (reward_xp >= 0),    -- NON-CASH points
  reward_coins bigint NOT NULL DEFAULT 0 CHECK (reward_coins >= 0), -- NON-CASH points
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_missions_active
  ON public.connect_missions (active, cadence);

-- Per-user mission progress. completed gates claim; claimed is idempotent.
CREATE TABLE IF NOT EXISTS public.connect_mission_progress (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.connect_missions(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  progress   integer NOT NULL DEFAULT 0 CHECK (progress >= 0),
  completed  boolean NOT NULL DEFAULT false,
  claimed    boolean NOT NULL DEFAULT false,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_connect_mission_progress_user
  ON public.connect_mission_progress (user_id, completed);

-- Per-user streak + NON-CASH coin balance projection. coins are points, NOT money.
CREATE TABLE IF NOT EXISTS public.connect_streaks (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_days integer NOT NULL DEFAULT 0 CHECK (current_days >= 0),
  best_days    integer NOT NULL DEFAULT 0 CHECK (best_days >= 0),
  coins        bigint NOT NULL DEFAULT 0 CHECK (coins >= 0),  -- NON-CASH points
  last_tick_on date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Season-pass periods.
CREATE TABLE IF NOT EXISTS public.connect_seasons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  starts_at  timestamptz NOT NULL DEFAULT now(),
  ends_at    timestamptz NOT NULL DEFAULT now(),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_seasons_active
  ON public.connect_seasons (active, starts_at DESC);

-- Periodic leaderboard snapshots (precomputed ranking by NON-CASH xp).
CREATE TABLE IF NOT EXISTS public.connect_leaderboard_snapshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope        text NOT NULL DEFAULT 'global'
                 CHECK (scope IN ('global','season','weekly','daily')),
  scope_ref    text,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rank         integer NOT NULL CHECK (rank >= 1),
  xp           bigint NOT NULL DEFAULT 0 CHECK (xp >= 0),  -- NON-CASH points
  captured_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, scope_ref, user_id, captured_at)
);
CREATE INDEX IF NOT EXISTS idx_connect_leaderboard_snapshots_scope
  ON public.connect_leaderboard_snapshots (scope, scope_ref, rank);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers (reuse generic public.handle_updated_at)
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'connect_live_sessions','connect_live_participants','connect_pk_battles',
    'connect_missions','connect_mission_progress','connect_streaks','connect_seasons'
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
ALTER TABLE public.connect_live_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_live_participants       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_pk_battles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_xp_ledger               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_missions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_mission_progress        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_streaks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_seasons                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_leaderboard_snapshots   ENABLE ROW LEVEL SECURITY;

-- live sessions: live/own/admin readable; host manages own; service bypass.
DROP POLICY IF EXISTS connect_live_sessions_read ON public.connect_live_sessions;
CREATE POLICY connect_live_sessions_read ON public.connect_live_sessions
  FOR SELECT TO authenticated
  USING (status = 'live' OR host_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_live_sessions_host ON public.connect_live_sessions;
CREATE POLICY connect_live_sessions_host ON public.connect_live_sessions
  FOR ALL TO authenticated
  USING (host_id = auth.uid() OR public.is_admin())
  WITH CHECK (host_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_live_sessions_service ON public.connect_live_sessions;
CREATE POLICY connect_live_sessions_service ON public.connect_live_sessions
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- live participants: self + the session host + admin may read; self may join.
DROP POLICY IF EXISTS connect_live_participants_read ON public.connect_live_participants;
CREATE POLICY connect_live_participants_read ON public.connect_live_participants
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin()
         OR EXISTS (SELECT 1 FROM public.connect_live_sessions s
                    WHERE s.id = connect_live_participants.session_id AND s.host_id = auth.uid()));
DROP POLICY IF EXISTS connect_live_participants_self_join ON public.connect_live_participants;
CREATE POLICY connect_live_participants_self_join ON public.connect_live_participants
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS connect_live_participants_service ON public.connect_live_participants;
CREATE POLICY connect_live_participants_service ON public.connect_live_participants
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- pk battles: readable to the two sessions' hosts + admin; writes service-only.
DROP POLICY IF EXISTS connect_pk_battles_read ON public.connect_pk_battles;
CREATE POLICY connect_pk_battles_read ON public.connect_pk_battles
  FOR SELECT TO authenticated
  USING (public.is_admin()
         OR EXISTS (SELECT 1 FROM public.connect_live_sessions s
                    WHERE s.id IN (connect_pk_battles.session_id, connect_pk_battles.opponent_session_id)
                      AND s.host_id = auth.uid()));
DROP POLICY IF EXISTS connect_pk_battles_service ON public.connect_pk_battles;
CREATE POLICY connect_pk_battles_service ON public.connect_pk_battles
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- xp ledger: owner reads own; admin all; writes service-only (server awards). Immutable.
DROP POLICY IF EXISTS connect_xp_ledger_own ON public.connect_xp_ledger;
CREATE POLICY connect_xp_ledger_own ON public.connect_xp_ledger
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_xp_ledger_service ON public.connect_xp_ledger;
CREATE POLICY connect_xp_ledger_service ON public.connect_xp_ledger
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- missions: active readable by anyone authed; only admin/service writes.
DROP POLICY IF EXISTS connect_missions_read ON public.connect_missions;
CREATE POLICY connect_missions_read ON public.connect_missions
  FOR SELECT TO authenticated USING (active OR public.is_admin());
DROP POLICY IF EXISTS connect_missions_admin_write ON public.connect_missions;
CREATE POLICY connect_missions_admin_write ON public.connect_missions
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS connect_missions_service ON public.connect_missions;
CREATE POLICY connect_missions_service ON public.connect_missions
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- mission progress: owner reads own; admin all; writes service-only.
DROP POLICY IF EXISTS connect_mission_progress_own ON public.connect_mission_progress;
CREATE POLICY connect_mission_progress_own ON public.connect_mission_progress
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_mission_progress_service ON public.connect_mission_progress;
CREATE POLICY connect_mission_progress_service ON public.connect_mission_progress
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- streaks: owner reads own; admin all; writes service-only.
DROP POLICY IF EXISTS connect_streaks_own ON public.connect_streaks;
CREATE POLICY connect_streaks_own ON public.connect_streaks
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_streaks_service ON public.connect_streaks;
CREATE POLICY connect_streaks_service ON public.connect_streaks
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- seasons: active readable by anyone authed; only admin/service writes.
DROP POLICY IF EXISTS connect_seasons_read ON public.connect_seasons;
CREATE POLICY connect_seasons_read ON public.connect_seasons
  FOR SELECT TO authenticated USING (active OR public.is_admin());
DROP POLICY IF EXISTS connect_seasons_admin_write ON public.connect_seasons;
CREATE POLICY connect_seasons_admin_write ON public.connect_seasons
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS connect_seasons_service ON public.connect_seasons;
CREATE POLICY connect_seasons_service ON public.connect_seasons
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- leaderboard snapshots: readable by anyone authed; writes service-only.
DROP POLICY IF EXISTS connect_leaderboard_read ON public.connect_leaderboard_snapshots;
CREATE POLICY connect_leaderboard_read ON public.connect_leaderboard_snapshots
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS connect_leaderboard_service ON public.connect_leaderboard_snapshots;
CREATE POLICY connect_leaderboard_service ON public.connect_leaderboard_snapshots
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC permissions for the new admin actions (additive; ON CONFLICT DO NOTHING).
-- Reuses enterprise RBAC tables + the connect-moderator role (connect_rbac.sql).
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Connect Live Sessions',      'connect.live.view',          'connect', 'live',          'view',    'View Connect live-session moderation list',      true),
  ('Moderate Connect Live Sessions',  'connect.live.moderate',      'connect', 'live',          'moderate','Terminate/moderate Connect live sessions',       true),
  ('View Connect Gamification',       'connect.gamification.view',  'connect', 'gamification',  'view',    'View Connect missions/seasons (non-cash)',       true),
  ('Manage Connect Gamification',     'connect.gamification.manage','connect', 'gamification',  'manage',  'Create/update Connect missions/seasons (non-cash)', true)
ON CONFLICT (slug) DO NOTHING;

-- Grant full new set to super-admin and system-admin.
WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('connect.live.view','connect.live.moderate','connect.gamification.view','connect.gamification.manage'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('connect.live.view','connect.live.moderate','connect.gamification.view','connect.gamification.manage'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- connect-moderator gets live moderation + gamification view (not season/mission management).
WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('connect.live.view','connect.live.moderate','connect.gamification.view'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'connect-moderator'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- Seed a couple of backend-owned non-cash missions + a launch season (idempotent).
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.connect_missions (code, title, cadence, target, reward_xp, reward_coins, meta, active) VALUES
  ('daily_login',     'Daily check-in',          'daily',  1, 50,  10, '{"trigger":"login"}'::jsonb, true),
  ('go_live',         'Go live once today',      'daily',  1, 200, 25, '{"trigger":"live_start"}'::jsonb, true),
  ('watch_3_lives',   'Watch 3 live sessions',   'daily',  3, 100, 15, '{"trigger":"live_join"}'::jsonb, true),
  ('weekly_streak_7', 'Keep a 7-day streak',     'weekly', 7, 500, 100,'{"trigger":"streak"}'::jsonb, true)
ON CONFLICT (code) DO NOTHING;

COMMIT;
