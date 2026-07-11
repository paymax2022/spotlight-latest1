-- Paymax Connect — Phase 6C + 6E (Full Profile + Recommendations)
-- Ref: docs/connect/PAYMAX-CONNECT-PHASE6-PROFESSIONAL-NETWORK.md (PR-07..PR-11, RC-01..RC-04).
--
-- Additive-only: CREATE TABLE/INDEX/POLICY IF NOT EXISTS, idempotent seeds. No
-- existing table is modified. Reused helpers: public.is_admin(),
-- public.handle_updated_at(). Every table has RLS with a service_role bypass.
--
-- PN-4 (CRITICAL): a recommendation is NEVER visible to anyone other than its
-- author/subject/admin until it reaches state='accepted_visible'. Enforced in
-- BOTH the reader RLS policy below AND the service query (WHERE state='accepted_visible').
-- Acceptance is an explicit subject action — the state machine never auto-publishes.
--
-- PN-1: profile strength is an internal completion/verification calc; no raw
-- granular trust number is stored or exposed — only a coarse band is surfaced.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- PR-07 — Experience timeline
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.connect_experience (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           text NOT NULL,
  company         text NOT NULL,
  location        text,
  start_date      date NOT NULL,
  end_date        date,                       -- NULL = current role
  description     text,
  -- Optional client-supplied dedup key so a retried create is a no-op (non-money).
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_connect_experience_user
  ON public.connect_experience (user_id, start_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_connect_experience_idem
  ON public.connect_experience (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- PR-08 — Education history
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.connect_education (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  institution     text NOT NULL,
  degree          text,
  field           text,
  start_date      date NOT NULL,
  end_date        date,                       -- NULL = in progress
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_connect_education_user
  ON public.connect_education (user_id, start_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_connect_education_idem
  ON public.connect_education (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- PR-09 — About summary (free-text professional summary; one row per user)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.connect_network_about (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  summary     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- RC-01..RC-03 — Recommendations (PN-4 consent-gated state machine)
--   DRAFTED → SENT → ACCEPTED_VISIBLE | DECLINED_HIDDEN
--   Only ACCEPTED_VISIBLE is queryable by anyone other than author/subject/admin.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.connect_recommendations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body            text NOT NULL,
  state           text NOT NULL DEFAULT 'drafted'
                    CHECK (state IN ('drafted','sent','accepted_visible','declined_hidden')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (author_user_id <> subject_user_id),
  -- One recommendation per author→subject pair; a retried write is idempotent.
  UNIQUE (author_user_id, subject_user_id)
);
-- Public read path (RC-03) is served ONLY by this partial index of accepted rows.
CREATE INDEX IF NOT EXISTS idx_connect_recos_subject_visible
  ON public.connect_recommendations (subject_user_id, created_at DESC)
  WHERE state = 'accepted_visible';
CREATE INDEX IF NOT EXISTS idx_connect_recos_inbox
  ON public.connect_recommendations (subject_user_id)
  WHERE state = 'sent';

-- ════════════════════════════════════════════════════════════════════════════
-- RC-04 — Request a recommendation (subject asks a connection to write one)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.connect_recommendation_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- future subject
  target_user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- future author
  note              text,
  state             text NOT NULL DEFAULT 'pending'
                      CHECK (state IN ('pending','fulfilled','declined')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (requester_user_id <> target_user_id),
  UNIQUE (requester_user_id, target_user_id)
);
CREATE INDEX IF NOT EXISTS idx_connect_reco_requests_target
  ON public.connect_recommendation_requests (target_user_id, state);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers (reuse generic public.handle_updated_at)
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['connect_network_about','connect_recommendations'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated ON public.%1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON public.%1$s '
      'FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()', t);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — deny-by-default; service_role bypass on every table.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.connect_experience               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_education                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_network_about            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_recommendations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_recommendation_requests  ENABLE ROW LEVEL SECURITY;

-- experience: owner manages own; professional experience is publicly readable; admin all.
DROP POLICY IF EXISTS connect_experience_owner ON public.connect_experience;
CREATE POLICY connect_experience_owner ON public.connect_experience
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS connect_experience_read ON public.connect_experience;
CREATE POLICY connect_experience_read ON public.connect_experience
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS connect_experience_service ON public.connect_experience;
CREATE POLICY connect_experience_service ON public.connect_experience
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- education: owner manages own; publicly readable; admin all.
DROP POLICY IF EXISTS connect_education_owner ON public.connect_education;
CREATE POLICY connect_education_owner ON public.connect_education
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS connect_education_read ON public.connect_education;
CREATE POLICY connect_education_read ON public.connect_education
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS connect_education_service ON public.connect_education;
CREATE POLICY connect_education_service ON public.connect_education
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- about: owner manages own; publicly readable; service bypass.
DROP POLICY IF EXISTS connect_about_owner ON public.connect_network_about;
CREATE POLICY connect_about_owner ON public.connect_network_about
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS connect_about_read ON public.connect_network_about;
CREATE POLICY connect_about_read ON public.connect_network_about
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS connect_about_service ON public.connect_network_about;
CREATE POLICY connect_about_service ON public.connect_network_about
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- recommendations: PN-4 READER LOCKDOWN. A row is readable ONLY when it is
-- accepted_visible, OR the reader is the author, the subject, or an admin.
-- Drafted/sent/declined rows are invisible to the public read path.
DROP POLICY IF EXISTS connect_recos_read ON public.connect_recommendations;
CREATE POLICY connect_recos_read ON public.connect_recommendations
  FOR SELECT TO authenticated
  USING (state = 'accepted_visible'
         OR author_user_id = auth.uid()
         OR subject_user_id = auth.uid()
         OR public.is_admin());
-- Only the author may create a recommendation about someone else.
DROP POLICY IF EXISTS connect_recos_author_insert ON public.connect_recommendations;
CREATE POLICY connect_recos_author_insert ON public.connect_recommendations
  FOR INSERT TO authenticated WITH CHECK (author_user_id = auth.uid());
-- State transitions (send/accept/decline) are performed via service_role after the
-- Go service verifies the actor (author for send, SUBJECT ONLY for accept/decline).
DROP POLICY IF EXISTS connect_recos_service ON public.connect_recommendations;
CREATE POLICY connect_recos_service ON public.connect_recommendations
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- recommendation requests: either party reads; requester creates; service updates.
DROP POLICY IF EXISTS connect_reco_requests_party ON public.connect_recommendation_requests;
CREATE POLICY connect_reco_requests_party ON public.connect_recommendation_requests
  FOR SELECT TO authenticated
  USING (requester_user_id = auth.uid() OR target_user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_reco_requests_insert ON public.connect_recommendation_requests;
CREATE POLICY connect_reco_requests_insert ON public.connect_recommendation_requests
  FOR INSERT TO authenticated WITH CHECK (requester_user_id = auth.uid());
DROP POLICY IF EXISTS connect_reco_requests_service ON public.connect_recommendation_requests;
CREATE POLICY connect_reco_requests_service ON public.connect_recommendation_requests
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC permissions for the new admin actions (additive; ON CONFLICT DO NOTHING).
-- Reuses the enterprise RBAC tables from 20260527100000_enterprise_auth_rbac.sql.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Connect Network Recommendations',    'connect.network.view',     'connect', 'recommendation', 'view',     'View Connect network profiles and the recommendation moderation queue', true),
  ('Moderate Connect Network Recommendations','connect.network.moderate', 'connect', 'recommendation', 'moderate', 'Hide/remove a Connect recommendation for policy violations', true)
ON CONFLICT (slug) DO NOTHING;

-- Grant full new set to super-admin and system-admin.
WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('connect.network.view','connect.network.moderate'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('connect.network.view','connect.network.moderate'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Connect-moderator gets view + moderate.
WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('connect.network.view','connect.network.moderate'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'connect-moderator'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
