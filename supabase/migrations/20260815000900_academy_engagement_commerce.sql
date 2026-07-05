-- Spotlight Academy — gamification, rewards, commerce, sponsors, analytics + RLS/RBAC.
-- Additive. Rewards credit the Paymax wallet ledger (no shadow ledger): the
-- academy_reward_ledger_entries row is the audit trail; the value movement is a
-- finance/ledger.Credit. No reward without a funded pool (golden rule 9).
BEGIN;

-- ───────────────────────── Gamification (engagement; no payout) ──────────────
CREATE TABLE IF NOT EXISTS public.academy_gamification_profiles (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  xp          bigint NOT NULL DEFAULT 0,
  level       int NOT NULL DEFAULT 1,
  streak_days int NOT NULL DEFAULT 0,
  freezes     int NOT NULL DEFAULT 0,
  last_active date,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.academy_badges (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code     text NOT NULL UNIQUE,
  name     text NOT NULL,
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  icon     text
);
CREATE TABLE IF NOT EXISTS public.academy_user_badges (
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_id  uuid NOT NULL REFERENCES public.academy_badges(id),
  earned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);

-- ───────────────────────── Sponsors / campaigns (fund pools) ─────────────────
CREATE TABLE IF NOT EXISTS public.academy_sponsors (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name    text NOT NULL,
  contact text,
  status  text NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS public.academy_campaigns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id   uuid REFERENCES public.academy_sponsors(id),
  name         text NOT NULL,
  budget_minor bigint NOT NULL DEFAULT 0,
  starts_at    timestamptz,
  ends_at      timestamptz,
  status       text NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS public.academy_challenges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,
  name           text NOT NULL,
  kind           text NOT NULL DEFAULT 'daily' CHECK (kind IN ('daily','weekly','sponsor')),
  criteria       jsonb NOT NULL DEFAULT '{}'::jsonb,
  sponsor_id     uuid REFERENCES public.academy_sponsors(id),
  reward_pool_id uuid,
  starts_at      timestamptz,
  ends_at        timestamptz,
  status         text NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS public.academy_leaderboards (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope        text NOT NULL CHECK (scope IN ('class','school','national','friends')),
  scope_ref    text,
  period       text NOT NULL DEFAULT 'weekly',
  reset_policy text NOT NULL DEFAULT 'weekly'
);
CREATE TABLE IF NOT EXISTS public.academy_leaderboard_entries (
  leaderboard_id uuid NOT NULL REFERENCES public.academy_leaderboards(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_key     text NOT NULL,
  score          bigint NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (leaderboard_id, user_id, period_key)
);

-- ───────────────────────── Rewards (sponsor-funded; on wallet rail) ──────────
CREATE TABLE IF NOT EXISTS public.academy_reward_pools (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id          uuid REFERENCES public.academy_sponsors(id),
  campaign_id         uuid REFERENCES public.academy_campaigns(id),
  name                text NOT NULL,
  currency            text NOT NULL DEFAULT 'NGN',
  funded_minor        bigint NOT NULL DEFAULT 0,
  spent_minor         bigint NOT NULL DEFAULT 0,   -- derived/maintained; balance = funded - spent
  per_user_cap_minor  bigint NOT NULL DEFAULT 0,   -- 0 = no cap
  per_campaign_cap_minor bigint NOT NULL DEFAULT 0,
  conversion_rate     numeric NOT NULL DEFAULT 1,  -- points → minor
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','exhausted','closed')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.academy_reward_ledger_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pool_id         uuid REFERENCES public.academy_reward_pools(id),
  type            text NOT NULL CHECK (type IN ('credit','redemption','reversal')),
  amount_minor    bigint NOT NULL DEFAULT 0,
  points          int NOT NULL DEFAULT 0,
  reason          text,
  source_event    text,
  wallet_ref      text,          -- finance/ledger entry reference (value movement)
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()  -- immutable; balances derived by summation
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_academy_reward_idem ON public.academy_reward_ledger_entries(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_academy_reward_user ON public.academy_reward_ledger_entries(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_academy_reward_pool ON public.academy_reward_ledger_entries(pool_id);

CREATE TABLE IF NOT EXISTS public.academy_redemption_catalog (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         text NOT NULL UNIQUE,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('wallet','airtime','data','voucher')),
  cost_points int NOT NULL,
  value_minor bigint NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS public.academy_redemptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sku             text NOT NULL,
  points_spent    int NOT NULL,
  value_minor     bigint NOT NULL DEFAULT 0,
  state           text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','fulfilled','failed','reversed')),
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_academy_redemption_idem ON public.academy_redemptions(idempotency_key);

-- ───────────────────────── Commerce & entitlements ───────────────────────────
CREATE TABLE IF NOT EXISTS public.academy_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  price_minor bigint NOT NULL DEFAULT 0,
  period      text NOT NULL DEFAULT 'monthly',
  features    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS public.academy_exam_bundles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arena_id    uuid REFERENCES public.academy_exam_arenas(id),
  name        text NOT NULL,
  price_minor bigint NOT NULL DEFAULT 0,
  contents    jsonb NOT NULL DEFAULT '{}'::jsonb,
  season      text,
  status      text NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS public.academy_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id         uuid NOT NULL REFERENCES public.academy_plans(id),
  state           text NOT NULL DEFAULT 'active' CHECK (state IN ('active','past_due','cancelled')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  renews_at       timestamptz,
  idempotency_key text
);
CREATE TABLE IF NOT EXISTS public.academy_entitlements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('plan','bundle','arena')),
  ref_id     uuid,
  state      text NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
  source     text NOT NULL CHECK (source IN ('order','bnpl','access_card','reward','scholarship')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, ref_id)
);
CREATE TABLE IF NOT EXISTS public.academy_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('plan','bundle')),
  ref_id          uuid NOT NULL,
  amount_minor    bigint NOT NULL DEFAULT 0,
  state           text NOT NULL DEFAULT 'cart'
                    CHECK (state IN ('cart','checkout','paid','bnpl_active','entitled','refunded')),
  payment_ref     text,
  bnpl_ref        text,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_academy_orders_idem ON public.academy_orders(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.academy_access_cards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch           text NOT NULL,
  serial          text NOT NULL UNIQUE,
  pin_hash        text NOT NULL,
  grant_kind      text NOT NULL CHECK (grant_kind IN ('plan','bundle')),
  grant_ref_id    uuid NOT NULL,
  state           text NOT NULL DEFAULT 'issued' CHECK (state IN ('issued','allocated','activated','void')),
  agent_id        uuid,
  activated_by    uuid REFERENCES auth.users(id),
  activated_at    timestamptz,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Analytics taxonomy (nfr.md) ───────────────────────
CREATE TABLE IF NOT EXISTS public.academy_analytics_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid,
  name               text NOT NULL,           -- install|first_lesson|mock_completed|reward_earned...
  props              jsonb NOT NULL DEFAULT '{}'::jsonb,
  curriculum_version text,
  class              text,
  subject            text,
  offline_origin     boolean NOT NULL DEFAULT false,
  ts                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_analytics_name ON public.academy_analytics_events(name, ts);

-- ───────────────────────── RLS — owner reads own; service_role all; admin read ─
DO $$
DECLARE
  owner_tables text[] := ARRAY[
    'academy_profiles','academy_gamification_profiles','academy_user_badges',
    'academy_attempts','academy_responses','academy_mastery_records','academy_progress_events',
    'academy_reward_ledger_entries','academy_redemptions','academy_subscriptions',
    'academy_entitlements','academy_orders','academy_analytics_events','academy_guardian_links','academy_consent_records'];
  admin_tables text[] := ARRAY[
    'academy_curriculum_versions','academy_classes','academy_streams','academy_trade_tracks',
    'academy_subjects','academy_topics','academy_learning_objectives','academy_lessons',
    'academy_content_bundles','academy_question_items','academy_past_questions','academy_exam_arenas',
    'academy_cbt_blueprints','academy_subject_combination_rules','academy_badges','academy_challenges',
    'academy_leaderboards','academy_leaderboard_entries','academy_sponsors','academy_campaigns',
    'academy_reward_pools','academy_redemption_catalog','academy_plans','academy_exam_bundles','academy_access_cards','academy_roles'];
  t text;
BEGIN
  FOREACH t IN ARRAY owner_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_owner ON public.%I', t, t);
    -- owner column is user_id where present; guardian/consent use minor/guardian; admins always read.
    IF t IN ('academy_guardian_links','academy_consent_records') THEN
      EXECUTE format('CREATE POLICY %I_owner ON public.%I FOR SELECT USING (public.is_admin() OR guardian_user_id = auth.uid() OR minor_user_id = auth.uid())', t, t);
    ELSE
      EXECUTE format('CREATE POLICY %I_owner ON public.%I FOR SELECT USING (public.is_admin() OR user_id = auth.uid())', t, t);
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
  FOREACH t IN ARRAY admin_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    -- curriculum/catalog content is readable by any authenticated user; writes via service_role.
    EXECUTE format('CREATE POLICY %I_read ON public.%I FOR SELECT USING (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
END $$;

-- ───────────────────────── RBAC — staff capabilities ─────────────────────────
INSERT INTO public.permissions (slug, description) VALUES
  ('academy.admin','Spotlight Academy super admin'),
  ('academy.content','Author/publish lessons + bundles'),
  ('academy.curriculum','Manage versioned curriculum'),
  ('academy.assessment','Manage question bank + items'),
  ('academy.exam','Configure exam arenas + blueprints'),
  ('academy.rewards','Manage reward pools + redemptions + wallet ops'),
  ('academy.commerce','Manage plans/bundles/access-cards/payments'),
  ('academy.sponsor','Manage sponsors + campaigns + funded pools'),
  ('academy.moderation','Moderate content/community + trust-safety'),
  ('academy.support','Support lookup + impersonation (audited)')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE p.slug LIKE 'academy.%' AND r.slug IN ('super-admin','system-admin')
ON CONFLICT DO NOTHING;

COMMIT;
