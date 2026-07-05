-- Referral Earning System — ECONOMY half (RB1)
-- Campaigns + budget governor, gamification, activity-based capped overrides,
-- merchant-funded campaigns + partner API.
-- Ref: docs/prd/referal/referral-PRD.md §6 (FR-CAMP, FR-GAM, FR-AMB/AGT, FR-MERCH),
--      §7 (reward model; overrides MUST be activity-based + capped + never recruitment),
--      §8B (A-CMP, A-GAM, A-AMB, A-MER);
--      docs/prd/referal/REFERRAL-BUILD-PLAN.md §3 (SHARED DB CONTRACT — RB0 owns the
--      core tables; THIS migration references them by name and never redefines them).
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX/POLICY IF NOT EXISTS, idempotent seeds.
--   NO DROP TABLE/COLUMN/TYPE, NO RENAME, NO type narrowing.
--   DROP POLICY IF EXISTS is used only to re-create policies idempotently.
-- Money columns are BIGINT kobo. FKs to auth.users(id) and to referral_campaigns etc.
-- RLS on every table with a service_role bypass; the engine writes via service-role.
--
-- §7 invariants encoded here:
--   * Overrides are ACTIVITY-BASED: a capped % of the verified activity/revenue of
--     network members — NEVER paid for recruitment. (network override base reads
--     qualifying-action / transaction events; recruitment alone earns nothing.)
--   * House-attributed signups (referral_attributions.is_house) are EXCLUDED from the
--     override base — enforced in the service layer and documented here.
--   * Per-tier override caps are enforced server-side (cap columns below + service).
--   * Gamification points are NON-CASH and live in a separate column, never kobo.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- CAMPAIGNS — campaign builder + budget governor
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,
  description     text,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','active','throttled','paused','ended')),
  -- reward_model: flat = fixed kobo; dynamic = JSON rule; ltv = % of referee LTV.
  reward_model    text NOT NULL DEFAULT 'flat'
                    CHECK (reward_model IN ('flat','dynamic','ltv')),
  reward_config   jsonb NOT NULL DEFAULT '{}'::jsonb,  -- e.g. {"flat_kobo":50000} / dynamic rules / {"ltv_bps":500}
  vesting_schedule_id uuid,                            -- optional ref (RB0/RB2 vesting)
  -- ROI guardrails (budget governor inputs).
  starts_at       timestamptz,
  ends_at         timestamptz,
  funding_source  text NOT NULL DEFAULT 'house'
                    CHECK (funding_source IN ('house','merchant','partner')),
  merchant_campaign_id uuid,                           -- set when funding_source='merchant'
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_campaigns_status
  ON public.referral_campaigns (status, starts_at);

-- Per-campaign budget + caps + governor counters (one row per campaign).
CREATE TABLE IF NOT EXISTS public.referral_campaign_budgets (
  campaign_id        uuid PRIMARY KEY REFERENCES public.referral_campaigns(id) ON DELETE CASCADE,
  total_budget_kobo  bigint NOT NULL DEFAULT 0 CHECK (total_budget_kobo >= 0),
  spent_kobo         bigint NOT NULL DEFAULT 0 CHECK (spent_kobo >= 0),
  per_user_cap_kobo  bigint NOT NULL DEFAULT 0 CHECK (per_user_cap_kobo >= 0),
  daily_cap_kobo     bigint NOT NULL DEFAULT 0 CHECK (daily_cap_kobo >= 0),
  -- ROI guardrails: auto-pause when realised CAC exceeds this, or fraud rate spikes.
  max_cac_kobo       bigint NOT NULL DEFAULT 0 CHECK (max_cac_kobo >= 0),
  fraud_pause_bps    int    NOT NULL DEFAULT 0 CHECK (fraud_pause_bps >= 0), -- basis points
  -- governor live state
  auto_paused        boolean NOT NULL DEFAULT false,
  auto_pause_reason  text,
  throttle_pct       int NOT NULL DEFAULT 100 CHECK (throttle_pct BETWEEN 0 AND 100),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- A/B variants of a campaign's reward config (FR-CAMP experimentation).
CREATE TABLE IF NOT EXISTS public.referral_ab_variants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES public.referral_campaigns(id) ON DELETE CASCADE,
  variant_key   text NOT NULL,                        -- 'A','B',...
  weight_pct    int  NOT NULL DEFAULT 50 CHECK (weight_pct BETWEEN 0 AND 100),
  reward_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, variant_key)
);
CREATE INDEX IF NOT EXISTS idx_referral_ab_variants_campaign
  ON public.referral_ab_variants (campaign_id, is_active);

-- ════════════════════════════════════════════════════════════════════════════
-- GAMIFICATION — missions/quests, ranks/tiers/badges, leaderboards, contests
-- Points are NON-CASH (points_reward); money rewards route via RB0 ledger.Accrue.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_missions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  title           text NOT NULL,
  description     text,
  mission_type    text NOT NULL DEFAULT 'quest'
                    CHECK (mission_type IN ('quest','mission','streak','challenge')),
  -- completion: target count of qualifying events.
  target_count    int  NOT NULL DEFAULT 1 CHECK (target_count > 0),
  -- NON-CASH points awarded on claim.
  points_reward   int  NOT NULL DEFAULT 0 CHECK (points_reward >= 0),
  -- OPTIONAL cash reward (kobo) — granted via RB0 ledger.Accrue (idempotent), never here.
  cash_reward_kobo bigint NOT NULL DEFAULT 0 CHECK (cash_reward_kobo >= 0),
  campaign_id     uuid REFERENCES public.referral_campaigns(id) ON DELETE SET NULL,
  is_active       boolean NOT NULL DEFAULT true,
  starts_at       timestamptz,
  ends_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_missions_active
  ON public.referral_missions (is_active, starts_at);

CREATE TABLE IF NOT EXISTS public.referral_mission_progress (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id    uuid NOT NULL REFERENCES public.referral_missions(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  progress      int  NOT NULL DEFAULT 0 CHECK (progress >= 0),
  status        text NOT NULL DEFAULT 'in_progress'
                  CHECK (status IN ('in_progress','completed','claimed')),
  claimed_at    timestamptz,
  -- idempotency for the points/cash grant on claim.
  claim_idempotency_key text UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_referral_mission_progress_user
  ON public.referral_mission_progress (user_id, status);

-- Ranks / tiers (rank thresholds in NON-CASH points).
CREATE TABLE IF NOT EXISTS public.referral_ranks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  tier_order    int  NOT NULL DEFAULT 0,
  min_points    int  NOT NULL DEFAULT 0 CHECK (min_points >= 0),
  perks         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Badges (awarded, non-cash).
CREATE TABLE IF NOT EXISTS public.referral_badges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  description   text,
  icon          text,
  criteria      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Leaderboard snapshots (materialised per period; non-cash standings).
CREATE TABLE IF NOT EXISTS public.referral_leaderboard_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period        text NOT NULL,                         -- e.g. '2026-W26','2026-06','all-time'
  scope         text NOT NULL DEFAULT 'global',
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rank_position int  NOT NULL DEFAULT 0,
  points        int  NOT NULL DEFAULT 0,
  metric        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period, scope, user_id)
);
CREATE INDEX IF NOT EXISTS idx_referral_leaderboard_period
  ON public.referral_leaderboard_snapshots (period, scope, rank_position);

-- Contests (time-boxed leaderboard competitions).
CREATE TABLE IF NOT EXISTS public.referral_contests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  title         text NOT NULL,
  description   text,
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','active','ended')),
  starts_at     timestamptz,
  ends_at       timestamptz,
  -- prize pool is informational; actual cash prizes are granted via RB0 ledger.Accrue.
  prize_config  jsonb NOT NULL DEFAULT '{}'::jsonb,
  campaign_id   uuid REFERENCES public.referral_campaigns(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_contests_status
  ON public.referral_contests (status, starts_at);

-- ════════════════════════════════════════════════════════════════════════════
-- NETWORK — ambassador + agent/team overrides (ACTIVITY-BASED, CAPPED, HOUSE-EXCL)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_ambassadors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  tier            text NOT NULL DEFAULT 'bronze',
  status          text NOT NULL DEFAULT 'applied'
                    CHECK (status IN ('applied','approved','suspended','rejected')),
  -- disclosure text stored at application time (compliance: paid-ambassador disclosure).
  disclosure_text text,
  disclosure_accepted_at timestamptz,
  applied_at      timestamptz NOT NULL DEFAULT now(),
  approved_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_ambassadors_status
  ON public.referral_ambassadors (status, tier);

-- Agent/team networks (an ambassador or agent leads a network).
CREATE TABLE IF NOT EXISTS public.referral_agent_networks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  network_type    text NOT NULL DEFAULT 'agent'
                    CHECK (network_type IN ('agent','team','ambassador')),
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','suspended')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_agent_networks_lead
  ON public.referral_agent_networks (lead_user_id, status);

-- Members of a network. is_house_attributed mirrors the member's
-- referral_attributions.is_house so the override base can EXCLUDE house signups.
CREATE TABLE IF NOT EXISTS public.referral_network_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL REFERENCES public.referral_agent_networks(id) ON DELETE CASCADE,
  member_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- snapshot of the member's house-attribution flag at join (also re-checked live).
  is_house_attributed boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','removed')),
  joined_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (network_id, member_user_id)
);
CREATE INDEX IF NOT EXISTS idx_referral_network_members_network
  ON public.referral_network_members (network_id, status);
CREATE INDEX IF NOT EXISTS idx_referral_network_members_user
  ON public.referral_network_members (member_user_id);

-- Override accrual rows. amount = capped % of the VERIFIED activity/revenue base of
-- network members, EXCLUDING house-attributed members. NEVER for recruitment.
-- Per-tier caps are enforced server-side; the applied cap is recorded for audit.
CREATE TABLE IF NOT EXISTS public.referral_overrides (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiary_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,  -- ambassador/agent lead
  network_id          uuid REFERENCES public.referral_agent_networks(id) ON DELETE SET NULL,
  source_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,          -- member whose activity drove this
  campaign_id         uuid REFERENCES public.referral_campaigns(id) ON DELETE SET NULL,
  -- the verified activity/revenue base this override was computed from (kobo).
  activity_base_kobo  bigint NOT NULL DEFAULT 0 CHECK (activity_base_kobo >= 0),
  override_bps        int    NOT NULL DEFAULT 0 CHECK (override_bps >= 0),         -- basis points applied
  amount_kobo         bigint NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
  cap_applied_kobo    bigint NOT NULL DEFAULT 0 CHECK (cap_applied_kobo >= 0),     -- per-tier cap in force
  -- the reward-ledger row this override produced (RB0 ledger.Accrue), for traceability.
  reward_ledger_id    uuid,
  idempotency_key     text NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Invariant: an override never roots in a recruitment payment — activity_base drives it.
  CHECK (activity_base_kobo > 0 OR amount_kobo = 0)
);
CREATE INDEX IF NOT EXISTS idx_referral_overrides_beneficiary
  ON public.referral_overrides (beneficiary_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_overrides_network
  ON public.referral_overrides (network_id, created_at DESC);

-- Per-tier override policy (rate + cap). Caps are enforced server-side.
CREATE TABLE IF NOT EXISTS public.referral_override_policies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier              text NOT NULL UNIQUE,
  override_bps      int  NOT NULL DEFAULT 0 CHECK (override_bps >= 0),
  per_member_cap_kobo bigint NOT NULL DEFAULT 0 CHECK (per_member_cap_kobo >= 0),
  monthly_cap_kobo  bigint NOT NULL DEFAULT 0 CHECK (monthly_cap_kobo >= 0),
  is_active         boolean NOT NULL DEFAULT true,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- MERCHANT — merchant-funded campaigns + partner API
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_merchants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','suspended')),
  -- wallet user that funds campaigns (the merchant's funding wallet).
  funding_wallet_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.referral_merchant_campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     uuid NOT NULL REFERENCES public.referral_merchants(id) ON DELETE CASCADE,
  campaign_id     uuid REFERENCES public.referral_campaigns(id) ON DELETE SET NULL,
  name            text NOT NULL,
  funded_kobo     bigint NOT NULL DEFAULT 0 CHECK (funded_kobo >= 0),
  settled_kobo    bigint NOT NULL DEFAULT 0 CHECK (settled_kobo >= 0),
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','funded','active','settled','ended')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_merchant_campaigns_merchant
  ON public.referral_merchant_campaigns (merchant_id, status);

-- Partner API keys (HASHED at rest, scoped). The plaintext is shown once at issue.
CREATE TABLE IF NOT EXISTS public.referral_partner_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     uuid NOT NULL REFERENCES public.referral_merchants(id) ON DELETE CASCADE,
  key_prefix      text NOT NULL,                       -- non-secret lookup prefix
  key_hash        text NOT NULL,                       -- sha256 hex of the full key
  scopes          jsonb NOT NULL DEFAULT '[]'::jsonb,  -- e.g. ["campaign.read","event.write"]
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','revoked')),
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  UNIQUE (key_prefix)
);
CREATE INDEX IF NOT EXISTS idx_referral_partner_keys_merchant
  ON public.referral_partner_keys (merchant_id, status);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers (reuse generic public.handle_updated_at)
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'referral_campaigns','referral_campaign_budgets','referral_missions',
    'referral_mission_progress','referral_contests','referral_ambassadors',
    'referral_agent_networks','referral_override_policies','referral_merchants',
    'referral_merchant_campaigns'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated ON public.%1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON public.%1$s '
      'FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()', t);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — deny-by-default; service_role bypass on every table.
-- Member-visible tables expose read of own/active rows; everything else admin-read.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.referral_campaigns             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_campaign_budgets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_ab_variants           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_missions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_mission_progress      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_ranks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_badges                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_leaderboard_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_contests              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_ambassadors           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_agent_networks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_network_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_overrides             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_override_policies      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_merchants             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_merchant_campaigns    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_partner_keys          ENABLE ROW LEVEL SECURITY;

-- campaigns: any authenticated member reads ACTIVE campaigns; admin reads all.
DROP POLICY IF EXISTS referral_campaigns_read ON public.referral_campaigns;
CREATE POLICY referral_campaigns_read ON public.referral_campaigns
  FOR SELECT TO authenticated
  USING (status = 'active' OR public.is_admin());
DROP POLICY IF EXISTS referral_campaigns_service ON public.referral_campaigns;
CREATE POLICY referral_campaigns_service ON public.referral_campaigns
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- budgets / ab variants: admin-read; service-write.
DROP POLICY IF EXISTS referral_campaign_budgets_admin ON public.referral_campaign_budgets;
CREATE POLICY referral_campaign_budgets_admin ON public.referral_campaign_budgets
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS referral_campaign_budgets_service ON public.referral_campaign_budgets;
CREATE POLICY referral_campaign_budgets_service ON public.referral_campaign_budgets
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS referral_ab_variants_admin ON public.referral_ab_variants;
CREATE POLICY referral_ab_variants_admin ON public.referral_ab_variants
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS referral_ab_variants_service ON public.referral_ab_variants;
CREATE POLICY referral_ab_variants_service ON public.referral_ab_variants
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- missions / ranks / badges / contests: any member reads active; admin reads all.
DROP POLICY IF EXISTS referral_missions_read ON public.referral_missions;
CREATE POLICY referral_missions_read ON public.referral_missions
  FOR SELECT TO authenticated USING (is_active OR public.is_admin());
DROP POLICY IF EXISTS referral_missions_service ON public.referral_missions;
CREATE POLICY referral_missions_service ON public.referral_missions
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS referral_ranks_read ON public.referral_ranks;
CREATE POLICY referral_ranks_read ON public.referral_ranks
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS referral_ranks_service ON public.referral_ranks;
CREATE POLICY referral_ranks_service ON public.referral_ranks
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS referral_badges_read ON public.referral_badges;
CREATE POLICY referral_badges_read ON public.referral_badges
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS referral_badges_service ON public.referral_badges;
CREATE POLICY referral_badges_service ON public.referral_badges
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS referral_contests_read ON public.referral_contests;
CREATE POLICY referral_contests_read ON public.referral_contests
  FOR SELECT TO authenticated USING (status = 'active' OR public.is_admin());
DROP POLICY IF EXISTS referral_contests_service ON public.referral_contests;
CREATE POLICY referral_contests_service ON public.referral_contests
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- mission progress / leaderboard: member reads OWN rows; admin reads all.
DROP POLICY IF EXISTS referral_mission_progress_own ON public.referral_mission_progress;
CREATE POLICY referral_mission_progress_own ON public.referral_mission_progress
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS referral_mission_progress_service ON public.referral_mission_progress;
CREATE POLICY referral_mission_progress_service ON public.referral_mission_progress
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS referral_leaderboard_read ON public.referral_leaderboard_snapshots;
CREATE POLICY referral_leaderboard_read ON public.referral_leaderboard_snapshots
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS referral_leaderboard_service ON public.referral_leaderboard_snapshots;
CREATE POLICY referral_leaderboard_service ON public.referral_leaderboard_snapshots
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ambassadors / networks / members: lead/member reads OWN; admin reads all.
DROP POLICY IF EXISTS referral_ambassadors_own ON public.referral_ambassadors;
CREATE POLICY referral_ambassadors_own ON public.referral_ambassadors
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS referral_ambassadors_service ON public.referral_ambassadors;
CREATE POLICY referral_ambassadors_service ON public.referral_ambassadors
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS referral_agent_networks_own ON public.referral_agent_networks;
CREATE POLICY referral_agent_networks_own ON public.referral_agent_networks
  FOR SELECT TO authenticated USING (lead_user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS referral_agent_networks_service ON public.referral_agent_networks;
CREATE POLICY referral_agent_networks_service ON public.referral_agent_networks
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS referral_network_members_read ON public.referral_network_members;
CREATE POLICY referral_network_members_read ON public.referral_network_members
  FOR SELECT TO authenticated USING (member_user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS referral_network_members_service ON public.referral_network_members;
CREATE POLICY referral_network_members_service ON public.referral_network_members
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- overrides: beneficiary reads OWN; admin reads all.
DROP POLICY IF EXISTS referral_overrides_own ON public.referral_overrides;
CREATE POLICY referral_overrides_own ON public.referral_overrides
  FOR SELECT TO authenticated USING (beneficiary_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS referral_overrides_service ON public.referral_overrides;
CREATE POLICY referral_overrides_service ON public.referral_overrides
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS referral_override_policies_read ON public.referral_override_policies;
CREATE POLICY referral_override_policies_read ON public.referral_override_policies
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS referral_override_policies_service ON public.referral_override_policies;
CREATE POLICY referral_override_policies_service ON public.referral_override_policies
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- merchants / merchant campaigns / partner keys: admin-read; service-write.
-- (partner keys are secret-bearing — never member-readable.)
DROP POLICY IF EXISTS referral_merchants_admin ON public.referral_merchants;
CREATE POLICY referral_merchants_admin ON public.referral_merchants
  FOR SELECT TO authenticated USING (owner_user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS referral_merchants_service ON public.referral_merchants;
CREATE POLICY referral_merchants_service ON public.referral_merchants
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS referral_merchant_campaigns_admin ON public.referral_merchant_campaigns;
CREATE POLICY referral_merchant_campaigns_admin ON public.referral_merchant_campaigns
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS referral_merchant_campaigns_service ON public.referral_merchant_campaigns;
CREATE POLICY referral_merchant_campaigns_service ON public.referral_merchant_campaigns
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS referral_partner_keys_admin ON public.referral_partner_keys;
CREATE POLICY referral_partner_keys_admin ON public.referral_partner_keys
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS referral_partner_keys_service ON public.referral_partner_keys;
CREATE POLICY referral_partner_keys_service ON public.referral_partner_keys
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC permissions (additive; ON CONFLICT DO NOTHING).
-- Reuses the enterprise RBAC tables from 20260527100000_enterprise_auth_rbac.sql.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Referral Campaigns',     'referral.campaign.view',     'referral', 'campaign', 'view',    'View referral campaigns + analytics',          true),
  ('Manage Referral Campaigns',   'referral.campaign.manage',   'referral', 'campaign', 'manage',  'CRUD campaigns, budgets, caps, throttle/pause', true),
  ('View Referral Gamification',  'referral.gam.view',          'referral', 'gam',      'view',    'View missions/ranks/badges/contests',          true),
  ('Manage Referral Gamification','referral.gam.manage',        'referral', 'gam',      'manage',  'Build missions/ranks/badges/contests',         true),
  ('View Referral Ambassadors',   'referral.amb.view',          'referral', 'amb',      'view',    'View ambassador/agent directory + overrides',  true),
  ('Manage Referral Ambassadors', 'referral.amb.manage',        'referral', 'amb',      'manage',  'Approve ambassadors, set override policy/caps', true),
  ('View Referral Merchants',     'referral.merchant.view',     'referral', 'merchant', 'view',    'View merchant-funded campaigns',               true),
  ('Manage Referral Merchants',   'referral.merchant.manage',   'referral', 'merchant', 'manage',  'CRUD merchants, fund campaigns, issue keys',   true)
ON CONFLICT (slug) DO NOTHING;

-- Grant the full referral econ set to super-admin and system-admin.
WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('referral.campaign.view','referral.campaign.manage','referral.gam.view','referral.gam.manage',
   'referral.amb.view','referral.amb.manage','referral.merchant.view','referral.merchant.manage'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('referral.campaign.view','referral.campaign.manage','referral.gam.view','referral.gam.manage',
   'referral.amb.view','referral.amb.manage','referral.merchant.view','referral.merchant.manage'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- SEEDS — starter ranks, a starter mission, and default override policies.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.referral_ranks (slug, name, tier_order, min_points)
VALUES
  ('bronze',   'Bronze',   1, 0),
  ('silver',   'Silver',   2, 500),
  ('gold',     'Gold',     3, 2000),
  ('platinum', 'Platinum', 4, 5000)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.referral_missions (slug, title, description, mission_type, target_count, points_reward, cash_reward_kobo, is_active)
VALUES
  ('first-invite', 'Send Your First Invite',
   'Refer your first friend who completes signup.', 'quest', 1, 100, 0, true),
  ('three-active', 'Activate Three Friends',
   'Refer three friends who each complete a qualifying action.', 'mission', 3, 500, 0, true)
ON CONFLICT (slug) DO NOTHING;

-- Default per-tier override policy (activity-based bps + caps; tunable by admin).
INSERT INTO public.referral_override_policies (tier, override_bps, per_member_cap_kobo, monthly_cap_kobo, is_active)
VALUES
  ('bronze',   200,  500000,  5000000,  true),   -- 2.0% of verified activity
  ('silver',   300, 1000000, 10000000,  true),   -- 3.0%
  ('gold',     500, 2000000, 25000000,  true),   -- 5.0%
  ('platinum', 750, 5000000, 50000000,  true)    -- 7.5%
ON CONFLICT (tier) DO NOTHING;

COMMIT;
