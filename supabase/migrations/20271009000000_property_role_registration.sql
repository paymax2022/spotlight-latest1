-- Property marketplace — role registration (estate manager / developer / agent).
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX guarded IF NOT EXISTS; permission and grant
-- inserts use ON CONFLICT DO NOTHING. Safe to re-run.
--
-- Three tables:
--   property_role_profiles   one row per (user, role): display name, role
--                            specific `details` JSON, lifecycle `status` and
--                            the admin-reviewed `verification_status`.
--   property_role_documents  supporting documents (licence, CAC certificate,
--                            authority letter, ID) as object-storage keys.
--   property_role_events     this feature's own audit trail of registrations,
--                            submissions and review decisions.
--
-- user_id / actor_id / verified_by are cross-module references with NO FK
-- (same convention as restaurant_likes and contestant_likes).
--
-- RLS posture: RLS is enabled with NO policy (deny-all) and the anon /
-- authenticated grants are revoked in THIS migration, not a follow-up. These
-- tables are reached only through the Go backend's service-role pgx pool,
-- which enforces the caller's identity in the service layer; no PostgREST
-- path should ever reach them.
--
-- Also registers the property.roles.review permission (admin review of role
-- registrations) and grants it to super-admin.

BEGIN;

CREATE TABLE IF NOT EXISTS public.property_role_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL,
  role                TEXT NOT NULL CHECK (role IN ('estate_manager', 'developer', 'agent')),
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'suspended')),
  verification_status TEXT NOT NULL DEFAULT 'unverified'
                      CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected')),
  display_name        TEXT NOT NULL,
  details             JSONB NOT NULL DEFAULT '{}'::jsonb,
  rejection_reason    TEXT,
  verified_at         TIMESTAMPTZ,
  verified_by         UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
CREATE INDEX IF NOT EXISTS idx_property_role_profiles_review
  ON public.property_role_profiles (verification_status, updated_at);

CREATE TABLE IF NOT EXISTS public.property_role_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES public.property_role_profiles(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_property_role_documents_profile
  ON public.property_role_documents (profile_id);

CREATE TABLE IF NOT EXISTS public.property_role_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        UUID NOT NULL REFERENCES public.property_role_profiles(id) ON DELETE CASCADE,
  actor_id          UUID NOT NULL,
  action            TEXT NOT NULL CHECK (action IN
                      ('registered', 'updated', 'submitted', 'approved', 'rejected', 'suspended', 'reset_to_unverified')),
  from_verification TEXT,
  to_verification   TEXT,
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_property_role_events_profile
  ON public.property_role_events (profile_id);

ALTER TABLE public.property_role_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_role_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_role_events    ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.property_role_profiles  FROM anon';
    EXECUTE 'REVOKE ALL ON public.property_role_documents FROM anon';
    EXECUTE 'REVOKE ALL ON public.property_role_events    FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.property_role_profiles  FROM authenticated';
    EXECUTE 'REVOKE ALL ON public.property_role_documents FROM authenticated';
    EXECUTE 'REVOKE ALL ON public.property_role_events    FROM authenticated';
  END IF;
END $$;

-- ── RBAC: review permission ───────────────────────────────────────────────────
INSERT INTO public.permissions(name, slug, module, resource, action, description, is_system_permission)
VALUES
('Review Property Role Registrations','property.roles.review','property','roles','review',
 'Approve, reject or suspend estate manager / developer / agent registrations',true)
ON CONFLICT (slug) DO NOTHING;

WITH r AS (SELECT id FROM public.roles WHERE slug = 'super-admin'),
     p AS (SELECT id FROM public.permissions WHERE slug = 'property.roles.review')
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
