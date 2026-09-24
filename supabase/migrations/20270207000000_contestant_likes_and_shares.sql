-- Contest module — contestant likes + profile share tracking.
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX guarded IF NOT EXISTS. Safe to re-run.
--
-- Backs the contestant profile screen's Like button and Share button, plus
-- the "# of Likes" / "# profile shared" stats on both the contestant profile
-- and contest detail screens. Shape mirrors 20270166000000_restaurant_likes.sql
-- (the closest existing "toggle + count" pattern): plain join/log tables, no
-- denormalized counters — both counts are always a live COUNT(*) at read
-- time, never a column that can drift from the source rows.
--
-- RLS is enabled with NO policy (deny-all) in THIS migration, not a follow-up
-- one — restaurant_likes shipped its RLS-disabled posture in one migration
-- and needed a second migration later to actually enable it, because the
-- first one's header only documented the intent without executing it. Both
-- tables here are reached exclusively through the Go backend's service-role
-- pgx pool (backend/internal/connect/voting), which enforces the caller's
-- own identity in the service layer — no PostgREST/anon-key path reaches
-- these rows, so deny-all + revoke is correct from the start.

BEGIN;

CREATE TABLE IF NOT EXISTS contestant_likes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL,                                              -- cross-module ref, no FK
  contestant_id  UUID NOT NULL REFERENCES contestants(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, contestant_id)
);
CREATE INDEX IF NOT EXISTS idx_contestant_likes_contestant ON contestant_likes(contestant_id);
CREATE INDEX IF NOT EXISTS idx_contestant_likes_user ON contestant_likes(user_id, created_at DESC);

-- One row per share action. share_token is the short code embedded in the
-- shareable link (e.g. https://spotlight.ng/vote/{share_token}); resolving
-- it (a public, unauthenticated read) is how the web landing page and the
-- app's deep-link handler find the contestant to route to. sharer_user_id is
-- kept for later attribution (e.g. crediting the sharer once the referred
-- voter's own signup completes) but nothing reads it yet — that is a
-- separate, not-yet-built feature; this migration only lands the shape.
CREATE TABLE IF NOT EXISTS contestant_shares (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contestant_id   UUID NOT NULL REFERENCES contestants(id) ON DELETE CASCADE,
  sharer_user_id  UUID NOT NULL,                                             -- cross-module ref, no FK
  share_token     TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contestant_shares_contestant ON contestant_shares(contestant_id);
CREATE INDEX IF NOT EXISTS idx_contestant_shares_sharer ON contestant_shares(sharer_user_id, created_at DESC);

DO $rls$ BEGIN
  IF to_regclass('public.contestant_likes') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.contestant_likes ENABLE ROW LEVEL SECURITY';
  END IF;
  IF to_regclass('public.contestant_shares') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.contestant_shares ENABLE ROW LEVEL SECURITY';
  END IF;
END $rls$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    IF to_regclass('public.contestant_likes') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON public.contestant_likes FROM anon';
    END IF;
    IF to_regclass('public.contestant_shares') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON public.contestant_shares FROM anon';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF to_regclass('public.contestant_likes') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON public.contestant_likes FROM authenticated';
    END IF;
    IF to_regclass('public.contestant_shares') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON public.contestant_shares FROM authenticated';
    END IF;
  END IF;
END $$;

COMMIT;
