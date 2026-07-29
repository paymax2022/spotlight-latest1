-- Trading "Module KYC" (Trading Access Verification) — §16B.1. DELIBERATELY
-- DECOUPLED from the super-app identity Tiers 0-3: its own status record, never
-- derived from and never writing back to user_profiles.kyc_tier. The trading
-- module gates access on THIS status alone. Additive-only.

-- Per-user verification record.
CREATE TABLE IF NOT EXISTS public.trading_kyc (
  user_id            uuid PRIMARY KEY,
  status             text NOT NULL DEFAULT 'NOT_STARTED'
                       CHECK (status IN ('NOT_STARTED','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','BYPASSED','EXPIRED')),
  submitted_at       timestamptz,
  reviewed_at        timestamptz,
  reviewer_id        uuid,
  reason_code        text,                         -- last decision reason (mandatory on reject/bypass)
  bypass_expires_at  timestamptz,                  -- time-box; only set while BYPASSED
  exposure_cap_kobo  bigint,                        -- reduced exposure cap while bypassed (NULL = none)
  client_ref         text,                          -- submit idempotency
  version            integer NOT NULL DEFAULT 0,    -- optimistic-concurrency guard
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Append-only decision/transition audit (never updated/deleted).
CREATE TABLE IF NOT EXISTS public.trading_kyc_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  event_type  text NOT NULL,                        -- submit|start_review|approve|reject|bypass|expire|revoke_bypass
  old_status  text,
  new_status  text NOT NULL,
  actor_id    uuid,                                 -- reviewer/maker/checker/system
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trading_kyc_events_user ON public.trading_kyc_events(user_id, created_at DESC);

-- Bypass register (§16B.1): every BYPASSED grant is a first-class, reportable
-- event — maker + checker (distinct), justification, time-box, optional revoke.
CREATE TABLE IF NOT EXISTS public.trading_kyc_bypass (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  maker_id           uuid NOT NULL,
  checker_id         uuid NOT NULL,
  reason             text NOT NULL,
  exposure_cap_kobo  bigint,
  granted_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoked_by         uuid,
  CONSTRAINT trading_kyc_bypass_two_person CHECK (maker_id <> checker_id)
);
CREATE INDEX IF NOT EXISTS trading_kyc_bypass_user ON public.trading_kyc_bypass(user_id, granted_at DESC);
CREATE INDEX IF NOT EXISTS trading_kyc_bypass_active ON public.trading_kyc_bypass(expires_at) WHERE revoked_at IS NULL;

-- RLS: a user reads only their OWN trading_kyc row; admins read all; service_role
-- writes. Events/bypass are admin/compliance-read, service-write.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.trading_kyc ENABLE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY trading_kyc_owner ON public.trading_kyc FOR SELECT USING (public.is_admin() OR user_id = auth.uid())';
  EXECUTE 'CREATE POLICY trading_kyc_service ON public.trading_kyc FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
  EXECUTE 'ALTER TABLE public.trading_kyc_events ENABLE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY trading_kyc_events_admin ON public.trading_kyc_events FOR SELECT USING (public.is_admin() OR user_id = auth.uid())';
  EXECUTE 'CREATE POLICY trading_kyc_events_service ON public.trading_kyc_events FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
  EXECUTE 'ALTER TABLE public.trading_kyc_bypass ENABLE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY trading_kyc_bypass_admin ON public.trading_kyc_bypass FOR SELECT USING (public.is_admin())';
  EXECUTE 'CREATE POLICY trading_kyc_bypass_service ON public.trading_kyc_bypass FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
END $$;

-- ── RBAC: trading admin permissions + sub-roles (§16B) ───────────────────────
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission) VALUES
  ('Review Trading KYC',        'trading.kyc.review',        'trading', 'kyc',    'review',  'Approve/Reject Module-KYC in the review queue', true),
  ('Initiate Trading Bypass',   'trading.kyc.bypass',        'trading', 'kyc',    'bypass',  'Initiate a KYC bypass (maker); grants access without standard verification', true),
  ('Approve Trading Bypass',    'trading.kyc.bypass.approve','trading', 'kyc',    'bypass_approve', 'Second-approve a KYC bypass (checker; must differ from maker)', true),
  ('Read Trading Audit',        'trading.audit.read',        'trading', 'audit',  'read',    'Read the trading KYC/bypass audit + register', true)
ON CONFLICT (slug) DO NOTHING;

-- Dedicated sub-roles (§16B: KYC Reviewer, Compliance). is_active + role_type=admin.
INSERT INTO public.roles (id, name, slug, description, role_type, is_system_role, is_active, created_at, updated_at) VALUES
  (gen_random_uuid(), 'Trading KYC Reviewer', 'trading-kyc-reviewer', 'Reviews and approves/rejects Module-KYC (no bypass)', 'admin', true, true, now(), now()),
  (gen_random_uuid(), 'Trading Compliance',   'trading-compliance',   'Bypass second-approver + audit/register visibility', 'admin', true, true, now(), now())
ON CONFLICT (slug) DO NOTHING;

-- Grants: super-admin + system-admin get everything; reviewer gets review+audit;
-- compliance gets bypass-approve (checker) + audit + review.
DO $$
DECLARE r_super uuid; r_sys uuid; r_rev uuid; r_comp uuid;
BEGIN
  SELECT id INTO r_super FROM public.roles WHERE slug='super-admin';
  SELECT id INTO r_sys   FROM public.roles WHERE slug='system-admin';
  SELECT id INTO r_rev   FROM public.roles WHERE slug='trading-kyc-reviewer';
  SELECT id INTO r_comp  FROM public.roles WHERE slug='trading-compliance';

  INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r, p.id FROM (VALUES (r_super),(r_sys)) v(r), public.permissions p
    WHERE p.slug IN ('trading.kyc.review','trading.kyc.bypass','trading.kyc.bypass.approve','trading.audit.read') AND r IS NOT NULL
  ON CONFLICT (role_id, permission_id) DO NOTHING;

  INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r_rev, p.id FROM public.permissions p
    WHERE p.slug IN ('trading.kyc.review','trading.audit.read') AND r_rev IS NOT NULL
  ON CONFLICT (role_id, permission_id) DO NOTHING;

  INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r_comp, p.id FROM public.permissions p
    WHERE p.slug IN ('trading.kyc.review','trading.kyc.bypass.approve','trading.audit.read') AND r_comp IS NOT NULL
  ON CONFLICT (role_id, permission_id) DO NOTHING;
END $$;
