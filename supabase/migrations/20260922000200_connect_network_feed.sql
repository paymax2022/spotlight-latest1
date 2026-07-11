-- Paymax Connect — Phase 6B (Content / Feed layer for the Professional Network).
-- Ref: docs/connect/PAYMAX-CONNECT-PHASE6-PROFESSIONAL-NETWORK.md §7-9 (Content Layer),
--      invariant PN-3 (rank by verified outcomes, not raw engagement).
--
-- Additive-only: CREATE TABLE/INDEX/POLICY IF NOT EXISTS, idempotent seeds.
-- NO existing table is modified. RLS deny-by-default with a service_role bypass on
-- every table (the Go backend uses the service-role pgx pool). Money is not involved
-- in this layer — posts/reactions/comments carry no monetary columns.
--
-- Reused helpers: public.is_admin(), public.handle_updated_at().
-- Reused table (READ-ONLY join for the verified-outcome ranking signal):
--   public.connect_professional_profiles (20260702000200_connect_phases_2to6.sql).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- Content tables
-- ════════════════════════════════════════════════════════════════════════════

-- A post authored by a user OR a company_page. reshare_of_post_id models a
-- reshare/quote of an existing post (self-referential FK). linked_outcome_*
-- records that a post is backed by a VERIFIED OUTCOME (a completed booking or
-- mentorship, or a passed assessment) — the primary PN-3 ranking signal.
-- idempotency_key makes a retried compose a safe no-op (ON CONFLICT DO NOTHING).
CREATE TABLE IF NOT EXISTS public.connect_posts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_type         text NOT NULL CHECK (author_type IN ('user','company_page')),
  author_id           uuid NOT NULL,
  body                text NOT NULL DEFAULT '',
  media_refs          text[] NOT NULL DEFAULT '{}',
  hashtags            text[] NOT NULL DEFAULT '{}',
  reshare_of_post_id  uuid REFERENCES public.connect_posts(id) ON DELETE SET NULL,
  -- Verified-outcome linkage (PN-3). NULL = no verified outcome attached.
  linked_outcome_type text CHECK (linked_outcome_type IN ('booking','mentorship','assessment')),
  linked_outcome_ref  text,
  visible             boolean NOT NULL DEFAULT true,
  idempotency_key     text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_connect_posts_idem
  ON public.connect_posts (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connect_posts_author
  ON public.connect_posts (author_type, author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connect_posts_visible_created
  ON public.connect_posts (created_at DESC) WHERE visible;
-- GIN index accelerates the hashtag/topic feed (hashtags @> ARRAY[tag]).
CREATE INDEX IF NOT EXISTS idx_connect_posts_hashtags
  ON public.connect_posts USING gin (hashtags) WHERE visible;

-- One reaction per (post,user) — UNIQUE enforces "one per user/post"; a change of
-- reaction_type is an upsert, a toggle-off is a delete (see repo.go).
CREATE TABLE IF NOT EXISTS public.connect_reactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       uuid NOT NULL REFERENCES public.connect_posts(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reaction_type text NOT NULL DEFAULT 'like'
                  CHECK (reaction_type IN ('like','celebrate','support','insightful','curious')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_connect_reactions_post ON public.connect_reactions (post_id);

-- Threaded comments. parent_comment_id NULL = top-level; non-NULL = a reply.
CREATE TABLE IF NOT EXISTS public.connect_comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id           uuid NOT NULL REFERENCES public.connect_posts(id) ON DELETE CASCADE,
  author_user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body              text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  parent_comment_id uuid REFERENCES public.connect_comments(id) ON DELETE CASCADE,
  idempotency_key   text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_connect_comments_idem
  ON public.connect_comments (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connect_comments_post
  ON public.connect_comments (post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_connect_comments_parent
  ON public.connect_comments (parent_comment_id) WHERE parent_comment_id IS NOT NULL;

-- Self-contained verified-outcome signals per author, owned by this package so the
-- ranking query has a stable source even before other phases (skill assessments,
-- mentorship completion) are wired. Other phases upsert here via service-role.
-- These are NON-public trust signals (PN-1): never returned by a public API.
CREATE TABLE IF NOT EXISTS public.connect_author_signals (
  user_id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  has_passed_assessment boolean NOT NULL DEFAULT false,
  completed_bookings    int NOT NULL DEFAULT 0 CHECK (completed_bookings >= 0),
  completed_mentorships int NOT NULL DEFAULT 0 CHECK (completed_mentorships >= 0),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at trigger (reuse generic public.handle_updated_at)
-- ════════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_connect_author_signals_updated ON public.connect_author_signals;
CREATE TRIGGER trg_connect_author_signals_updated
  BEFORE UPDATE ON public.connect_author_signals
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — deny-by-default; service_role bypass on every table.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.connect_posts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_reactions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_comments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_author_signals  ENABLE ROW LEVEL SECURITY;

-- posts: visible posts readable by any authed user; admin sees all (moderation).
DROP POLICY IF EXISTS connect_posts_read ON public.connect_posts;
CREATE POLICY connect_posts_read ON public.connect_posts
  FOR SELECT TO authenticated USING (visible OR public.is_admin());
DROP POLICY IF EXISTS connect_posts_author_write ON public.connect_posts;
CREATE POLICY connect_posts_author_write ON public.connect_posts
  FOR INSERT TO authenticated
  WITH CHECK (author_type = 'user' AND author_id = auth.uid());
DROP POLICY IF EXISTS connect_posts_service ON public.connect_posts;
CREATE POLICY connect_posts_service ON public.connect_posts
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- reactions: reactor manages own; anyone authed reads (for counts); service all.
DROP POLICY IF EXISTS connect_reactions_read ON public.connect_reactions;
CREATE POLICY connect_reactions_read ON public.connect_reactions
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS connect_reactions_owner ON public.connect_reactions;
CREATE POLICY connect_reactions_owner ON public.connect_reactions
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS connect_reactions_service ON public.connect_reactions;
CREATE POLICY connect_reactions_service ON public.connect_reactions
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- comments: anyone authed reads; author creates own; service moderates.
DROP POLICY IF EXISTS connect_comments_read ON public.connect_comments;
CREATE POLICY connect_comments_read ON public.connect_comments
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS connect_comments_author ON public.connect_comments;
CREATE POLICY connect_comments_author ON public.connect_comments
  FOR INSERT TO authenticated WITH CHECK (author_user_id = auth.uid());
DROP POLICY IF EXISTS connect_comments_service ON public.connect_comments;
CREATE POLICY connect_comments_service ON public.connect_comments
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- author signals: NON-public trust data (PN-1). Owner may read own row; writes are
-- service-only. No public read path exposes these numbers.
DROP POLICY IF EXISTS connect_author_signals_own ON public.connect_author_signals;
CREATE POLICY connect_author_signals_own ON public.connect_author_signals
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_author_signals_service ON public.connect_author_signals;
CREATE POLICY connect_author_signals_service ON public.connect_author_signals
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC — content moderation (ADM-CN-01). connect.moderation.manage already exists
-- (20260920000400_rbac_seed_gaps_round2.sql); re-asserted idempotently so this
-- migration is self-contained. Additive; ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Manage Connect Moderation','connect.moderation.manage','connect','moderation','manage',
     'Act on connect moderation cases including content-feed post takedowns (ADM-CN-01)', true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug = 'connect.moderation.manage')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM p, public.roles r
WHERE r.slug IN ('super-admin','system-admin','connect-moderator')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
