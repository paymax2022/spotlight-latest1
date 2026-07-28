-- Paymax Top-5 Phase 3 — Creators monetisation
-- Ref: docs/estate/BUILD-PLAN.md EPIC 3.1; docs/estate/CLAUDE.md
--      NL-5 (perks NOT returns — creator income delivers content/perks, never a
--      financial return / revenue share), NL-8 (ledger), NL-9 (idempotent tip /
--      content sale / subscription charge), NL-10 (payout KYC gate), NL-11 (content
--      moderation + age controls), NL-12 (audit).
--
-- ADDITIVE-ONLY. Money is kobo BIGINT; the actual money lives in the finance ledger
-- (these tables are projections). FKs to auth.users(id). RLS everywhere with a
-- service_role bypass. There is NO column anywhere expressing a yield / dividend /
-- investor share — every creator credit is payment for content/access (NL-5).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- CREATOR capability + storefront. One per user (object-level authZ).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.creator_profiles (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  handle         text,
  display_name   text NOT NULL,
  bio            text,
  state          text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','APPROVED','SUSPENDED')),
  storefront_url text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Storefront view rows (optional curated sections; the profile is the canonical
-- storefront, this carries display config so admins can feature creators).
CREATE TABLE IF NOT EXISTS public.creator_storefronts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES public.creator_profiles(user_id) ON DELETE CASCADE,
  banner_url text,
  theme      jsonb NOT NULL DEFAULT '{}'::jsonb,
  featured   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creator_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- TIP JAR — one-off tips (money in finance ledger; this is the idempotent record).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.creator_tips (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creator_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (from_user_id <> creator_id)
);
CREATE INDEX IF NOT EXISTS idx_creator_tips_creator ON public.creator_tips (creator_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- PAID CONTENT — moderation-gated + age-rated (NL-11). Not served until APPROVED.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.creator_content (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title            text NOT NULL,
  body             text,
  price_kobo       bigint NOT NULL DEFAULT 0 CHECK (price_kobo >= 0),  -- 0 = free
  age_rating       text NOT NULL DEFAULT 'ALL' CHECK (age_rating IN ('ALL','13+','18+')),
  moderation_state text NOT NULL DEFAULT 'PENDING' CHECK (moderation_state IN ('PENDING','APPROVED','REJECTED')),
  published        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_creator_content_creator ON public.creator_content (creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_content_pending ON public.creator_content (moderation_state) WHERE moderation_state = 'PENDING';

-- Moderation case log (NL-11 / NL-12).
CREATE TABLE IF NOT EXISTS public.content_moderation (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id   uuid NOT NULL REFERENCES public.creator_content(id) ON DELETE CASCADE,
  state        text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','APPROVED','REJECTED')),
  moderator_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_content_moderation_content ON public.content_moderation (content_id, created_at DESC);

-- ENTITLEMENTS — paid-content access grants. GRANTED → REVOKED.
CREATE TABLE IF NOT EXISTS public.content_entitlements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_id      uuid NOT NULL REFERENCES public.creator_content(id) ON DELETE CASCADE,
  state           text NOT NULL DEFAULT 'GRANTED' CHECK (state IN ('GRANTED','REVOKED')),
  idempotency_key text NOT NULL UNIQUE,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_content_entitlements_user ON public.content_entitlements (user_id, content_id);

-- ════════════════════════════════════════════════════════════════════════════
-- SUBSCRIPTIONS — recurring tiers (scheduler-driven). ACTIVE → PAST_DUE → CANCELLED.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.creator_subscription_tiers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  price_kobo    bigint NOT NULL CHECK (price_kobo > 0),
  interval_secs bigint NOT NULL CHECK (interval_secs > 0),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sub_tiers_creator ON public.creator_subscription_tiers (creator_id);

CREATE TABLE IF NOT EXISTS public.creator_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creator_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier_id       uuid NOT NULL REFERENCES public.creator_subscription_tiers(id) ON DELETE CASCADE,
  state         text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','PAST_DUE','CANCELLED')),
  job_id        uuid,                                   -- scheduler_jobs.id driving recurrence
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (subscriber_id <> creator_id)
);
CREATE INDEX IF NOT EXISTS idx_creator_subs_subscriber ON public.creator_subscriptions (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_creator_subs_creator ON public.creator_subscriptions (creator_id);

-- ════════════════════════════════════════════════════════════════════════════
-- EARNINGS LEDGER + PAYOUTS. Earnings are NET-of-fee projections of the money that
-- already moved through the finance ledger. NL-5: kind is constrained to payment-
-- for-content kinds — there is no "return"/"yield" kind.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.creator_earnings_ledger (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('TIP','CONTENT_SALE','SUBSCRIPTION')),
  gross_kobo bigint NOT NULL CHECK (gross_kobo >= 0),
  fee_kobo   bigint NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),
  net_kobo   bigint NOT NULL CHECK (net_kobo >= 0),
  reference  text NOT NULL UNIQUE,                       -- idempotent earnings row
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_creator_earnings_creator ON public.creator_earnings_ledger (creator_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.creator_payouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  state       text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED','PAID','REJECTED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_creator_payouts_creator ON public.creator_payouts (creator_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers.
-- ════════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_creator_profiles_updated ON public.creator_profiles;
CREATE TRIGGER trg_creator_profiles_updated BEFORE UPDATE ON public.creator_profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_creator_subs_updated ON public.creator_subscriptions;
CREATE TRIGGER trg_creator_subs_updated BEFORE UPDATE ON public.creator_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_creator_payouts_updated ON public.creator_payouts;
CREATE TRIGGER trg_creator_payouts_updated BEFORE UPDATE ON public.creator_payouts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security. Owner/creator/viewer scoped reads; service_role writes.
-- NL-11: only APPROVED+published content is publicly readable; PENDING/REJECTED is
-- visible only to its owning creator + admins (never broadly served).
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.creator_profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_storefronts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_tips                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_content             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_moderation          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_entitlements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_subscription_tiers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_subscriptions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_earnings_ledger     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_payouts             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS creator_profiles_read ON public.creator_profiles;
CREATE POLICY creator_profiles_read ON public.creator_profiles
  FOR SELECT TO authenticated USING (state = 'APPROVED' OR user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS creator_profiles_service ON public.creator_profiles;
CREATE POLICY creator_profiles_service ON public.creator_profiles
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS creator_storefronts_read ON public.creator_storefronts;
CREATE POLICY creator_storefronts_read ON public.creator_storefronts
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS creator_storefronts_service ON public.creator_storefronts;
CREATE POLICY creator_storefronts_service ON public.creator_storefronts
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS creator_tips_party ON public.creator_tips;
CREATE POLICY creator_tips_party ON public.creator_tips
  FOR SELECT TO authenticated USING (from_user_id = auth.uid() OR creator_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS creator_tips_service ON public.creator_tips;
CREATE POLICY creator_tips_service ON public.creator_tips
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS creator_content_read ON public.creator_content;
CREATE POLICY creator_content_read ON public.creator_content
  FOR SELECT TO authenticated USING (
    (moderation_state = 'APPROVED' AND published = TRUE) OR creator_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS creator_content_service ON public.creator_content;
CREATE POLICY creator_content_service ON public.creator_content
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS content_moderation_admin ON public.content_moderation;
CREATE POLICY content_moderation_admin ON public.content_moderation
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS content_moderation_service ON public.content_moderation;
CREATE POLICY content_moderation_service ON public.content_moderation
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS content_entitlements_own ON public.content_entitlements;
CREATE POLICY content_entitlements_own ON public.content_entitlements
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS content_entitlements_service ON public.content_entitlements;
CREATE POLICY content_entitlements_service ON public.content_entitlements
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS sub_tiers_read ON public.creator_subscription_tiers;
CREATE POLICY sub_tiers_read ON public.creator_subscription_tiers
  FOR SELECT TO authenticated USING (active = TRUE OR creator_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS sub_tiers_service ON public.creator_subscription_tiers;
CREATE POLICY sub_tiers_service ON public.creator_subscription_tiers
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS creator_subs_party ON public.creator_subscriptions;
CREATE POLICY creator_subs_party ON public.creator_subscriptions
  FOR SELECT TO authenticated USING (subscriber_id = auth.uid() OR creator_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS creator_subs_service ON public.creator_subscriptions;
CREATE POLICY creator_subs_service ON public.creator_subscriptions
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS creator_earnings_own ON public.creator_earnings_ledger;
CREATE POLICY creator_earnings_own ON public.creator_earnings_ledger
  FOR SELECT TO authenticated USING (creator_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS creator_earnings_service ON public.creator_earnings_ledger;
CREATE POLICY creator_earnings_service ON public.creator_earnings_ledger
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS creator_payouts_own ON public.creator_payouts;
CREATE POLICY creator_payouts_own ON public.creator_payouts
  FOR SELECT TO authenticated USING (creator_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS creator_payouts_service ON public.creator_payouts;
CREATE POLICY creator_payouts_service ON public.creator_payouts
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC — creators.* . Additive; ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Verify Creators',        'creators.verify',   'creators','profile', 'verify',  'Approve/suspend creators',          true),
  ('Moderate Creator Content','creators.moderate','creators','content', 'moderate','Approve/reject creator content (NL-11)', true),
  ('Settle Creator Payouts', 'creators.payout',   'creators','payout',  'settle',  'Mark creator payouts paid',         true),
  ('View Creators (Admin)',  'creators.read',     'creators','admin',   'view',    'View creator standing + billing',   true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'creators.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
