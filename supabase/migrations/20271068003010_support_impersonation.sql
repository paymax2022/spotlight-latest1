-- ESTD-D028 (S1, EST-UAT-0422): safe, read-only support "view-as".
-- Design: docs/adr/ADR-PR<pr-number>-step-up-and-support-impersonation.md
-- (cited as ADR-PR<pr-number> until adr-assign.yml numbers it on merge).
--
-- A support agent never receives a token for the user. Instead the backend
-- records an impersonation SESSION (who, whom, why, ticket, until when) bound to
-- the agent's own bearer token, and an explicit allow-list of GET endpoints
-- honours it (backend/internal/supportimpersonation). Every start, stop, served
-- request and refused attempt is an append-only event row.
--
-- The sessions table doubles as the user-visible notice: the impersonated user
-- can list every support access to their account (GET /api/auth/support-access).
--
-- Additive-only: two new tables, one permission, one role. Backend-only tables:
-- RLS ENABLEd, no policy (deny-all to anon/authenticated), as in
-- 20271067000020_rls_backend_only_tables.sql.

CREATE TABLE IF NOT EXISTS public.support_impersonation_sessions (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id           uuid        NOT NULL,
  target_user_id          uuid        NOT NULL,
  reason                  text        NOT NULL CHECK (length(btrim(reason)) >= 10),
  ticket_ref              text        NOT NULL CHECK (length(btrim(ticket_ref)) >= 3),
  actor_token_hash        text        NOT NULL CHECK (length(actor_token_hash) = 64),
  mode                    text        NOT NULL DEFAULT 'read_only' CHECK (mode = 'read_only'),
  started_at              timestamptz NOT NULL DEFAULT now(),
  expires_at              timestamptz NOT NULL,
  ended_at                timestamptz,
  end_reason              text,
  ip_address              text,
  user_agent              text,
  CHECK (actor_user_id <> target_user_id),
  CHECK (expires_at > started_at),
  CHECK (expires_at <= started_at + interval '60 minutes')
);

COMMENT ON TABLE public.support_impersonation_sessions IS
  'Time-boxed, read-only support view-as sessions; also the impersonated user''s notice. ESTD-D028 / ADR-PR<pr-number>.';

CREATE INDEX IF NOT EXISTS support_impersonation_sessions_actor_idx
  ON public.support_impersonation_sessions (actor_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS support_impersonation_sessions_target_idx
  ON public.support_impersonation_sessions (target_user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.support_impersonation_events (
  id             bigserial   PRIMARY KEY,
  session_id     uuid        NOT NULL REFERENCES public.support_impersonation_sessions(id),
  actor_user_id  uuid        NOT NULL,
  target_user_id uuid        NOT NULL,
  event          text        NOT NULL CHECK (event IN ('start','stop','request','refused','expired')),
  method         text,
  path           text,
  route          text,
  status_code    int,
  detail         text,
  ip_address     text,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.support_impersonation_events IS
  'Append-only audit trail of every support impersonation start/stop/request/refusal. ESTD-D028 / ADR-PR<pr-number>.';

CREATE INDEX IF NOT EXISTS support_impersonation_events_session_idx
  ON public.support_impersonation_events (session_id, created_at);
CREATE INDEX IF NOT EXISTS support_impersonation_events_target_idx
  ON public.support_impersonation_events (target_user_id, created_at DESC);

ALTER TABLE public.support_impersonation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_impersonation_events   ENABLE ROW LEVEL SECURITY;

-- Dedicated permission + role. Deliberately NOT granted to super-admin or
-- system-admin: the guard checks the EXPLICIT effective permission set
-- (effective_permissions), not user_has_permission()'s super-admin bypass, so
-- holding an admin role alone never confers view-as. Grant the role per agent.
BEGIN;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Support Impersonate (read-only)', 'support.impersonate', 'support', 'impersonation', 'start',
   'Start a time-boxed, read-only, fully audited support view-as session for a user (reason + ticket mandatory, step-up required)', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.roles (name, slug, description, role_type, is_system_role)
VALUES
  ('Support Impersonation Agent', 'support-impersonation-agent',
   'Support staff allowed to open read-only, audited view-as sessions (ESTD-D028)', 'admin', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r, public.permissions p
 WHERE r.slug = 'support-impersonation-agent' AND p.slug = 'support.impersonate'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
