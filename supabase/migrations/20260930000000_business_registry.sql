-- Business Registry — CAC (Corporate Affairs Commission) business-name
-- verification + registration, gating the customer → merchant/service-provider
-- upgrade. COMPLEMENTS the merchant onboarding subsystem (onb_*): the business
-- profile is the verified/registered CAC identity that onboarding requires before
-- granting a merchant role (see business.Service.HasVerifiedBusiness).
--
-- Iron rules honored:
--   * ADDITIVE-ONLY — new tables only; no DROP / RENAME / type-narrowing.
--   * business_profile_events is APPEND-ONLY (immutable trigger blocks UPDATE/DELETE).
--   * Money: the CAC registration fee is a real idempotent wallet debit posted through
--     the finance ledger (DR user_wallet → CR paymax_revenue) by the Go service — this
--     migration stores only the audit fields (fee_kobo, fee_ledger_ref). No balance
--     column is ever mutated here.
--   * RLS deny-by-default: owners read their own rows; service_role does all writes.
BEGIN;

-- ── business_profiles ─────────────────────────────────────────────────────────
-- One row per business a user verifies (existing RC/BN) or registers (new). The
-- state column is the register-new / verify-existing state machine (see
-- internal/business/statemachine.go). rc_or_bn_number is the CAC number once known.
CREATE TABLE IF NOT EXISTS public.business_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type         text NOT NULL DEFAULT 'business_name'
                          CHECK (entity_type IN ('business_name','company','incorporated_trustee')),
  mode                text NOT NULL
                          CHECK (mode IN ('verify_existing','register_new')),
  legal_name          text,               -- confirmed legal name (post-verify/register)
  proposed_name       text,               -- name being reserved/registered (register_new)
  line_of_business    text,
  status              text NOT NULL DEFAULT 'draft'
                          CHECK (status IN (
                            'draft','name_check','name_reserved','registration_submitted',
                            'under_review','registered',            -- register_new path
                            'submitted','verified',                 -- verify_existing path
                            'rejected','failed'                     -- terminal failure
                          )),
  rc_or_bn_number     text,               -- CAC RC (company) or BN (business name) number
  cac_reservation_ref text,               -- name-reservation / availability-code ref
  cac_registration_ref text,              -- submitted-registration provider ref
  verification_source text,               -- e.g. 'cac-vas' | 'cac-sandbox'
  registered_at       date,               -- CAC registration date (verify/register)
  fee_kobo            bigint NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),
  fee_ledger_ref      text,               -- ledger idempotency/reference for the fee debit
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_profiles_user   ON public.business_profiles(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_profiles_status ON public.business_profiles(status);
-- At most one profile per user per resolved CAC number (prevents duplicate claims of
-- the same registered business). Partial: only enforced once a number is known, so
-- multiple in-flight drafts (NULL number) are allowed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_profiles_user_rcbn
  ON public.business_profiles(user_id, rc_or_bn_number)
  WHERE rc_or_bn_number IS NOT NULL;

-- ── business_profile_proprietors ──────────────────────────────────────────────
-- Owners / partners / directors / trustees attached to a registration. BVN/NIN are
-- PII — only a MASKED tail is persisted here; the raw value is forwarded to CAC by
-- the provider adapter and never stored/logged (mirrors the KYC masking pattern).
CREATE TABLE IF NOT EXISTS public.business_profile_proprietors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  full_name    text NOT NULL,
  role         text NOT NULL DEFAULT 'proprietor'
                   CHECK (role IN ('proprietor','partner','director','trustee','shareholder','secretary')),
  bvn_masked   text,               -- e.g. '*******1234'
  nin_masked   text,
  share_pct    int  NOT NULL DEFAULT 0 CHECK (share_pct >= 0 AND share_pct <= 100),
  phone        text,
  email        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_proprietors_business ON public.business_profile_proprietors(business_id);

-- ── business_profile_events (APPEND-ONLY audit) ───────────────────────────────
-- Every state transition + admin action is logged here. Immutable: an UPDATE or
-- DELETE raises an exception (append-only guard below), mirroring the ledger/crypto
-- audit immutability convention.
CREATE TABLE IF NOT EXISTS public.business_profile_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  event        text NOT NULL,                 -- e.g. 'name.checked','fee.paid','admin.approved'
  from_status  text,
  to_status    text,
  actor        text NOT NULL,                 -- user id or admin id performing the action
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_events_business ON public.business_profile_events(business_id, created_at DESC);

-- Append-only guard: block UPDATE/DELETE on the events table.
CREATE OR REPLACE FUNCTION public.business_events_no_mutate()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'business_profile_events is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_business_events_no_update ON public.business_profile_events;
CREATE TRIGGER trg_business_events_no_update
  BEFORE UPDATE OR DELETE ON public.business_profile_events
  FOR EACH ROW EXECUTE FUNCTION public.business_events_no_mutate();

-- Keep updated_at fresh on business_profiles mutations.
CREATE OR REPLACE FUNCTION public.business_profiles_touch()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_business_profiles_touch ON public.business_profiles;
CREATE TRIGGER trg_business_profiles_touch
  BEFORE UPDATE ON public.business_profiles
  FOR EACH ROW EXECUTE FUNCTION public.business_profiles_touch();

-- ── RLS (deny-by-default; owner read + service_role writes) ────────────────────
DO $$
DECLARE
  owner_tables text[] := ARRAY['business_profiles'];
  child_tables text[] := ARRAY['business_profile_proprietors','business_profile_events'];
  t text;
BEGIN
  -- Owner-readable tables: the owning user (or an admin) may SELECT; service_role
  -- performs all writes (the Go service uses the service-role pgx pool).
  FOREACH t IN ARRAY owner_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_owner ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_owner ON public.%I FOR SELECT USING (public.is_admin() OR user_id = auth.uid())', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
  -- Child tables: read gated by ownership of the parent business_profile row; all
  -- writes are service_role only.
  FOREACH t IN ARRAY child_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_owner ON public.%I', t, t);
    EXECUTE format($f$CREATE POLICY %I_owner ON public.%I FOR SELECT USING (
      public.is_admin() OR EXISTS (
        SELECT 1 FROM public.business_profiles b
        WHERE b.id = %I.business_id AND b.user_id = auth.uid()))$f$, t, t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
END $$;

-- ── RBAC: admin review permission (reuse existing RBAC tables) ─────────────────
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission) VALUES
  ('Review Business Registry','business.registry.review','business','business_profile','review',
   'Can review, approve and reject CAC business registrations', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE p.slug = 'business.registry.review' AND r.slug IN ('super-admin','system-admin')
ON CONFLICT DO NOTHING;

COMMIT;
