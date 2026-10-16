-- Migration: crossborder_pricing_admin (SP-3a Task 9a)
-- Persistence for the Pricing & Platform-Fee admin console:
--   * crossborder_fee_rules              Platform-Fee schedule (pricing.FeeRule), versioned,
--                                        maker-checker + effective dating
--   * crossborder_rate_card              L0 Verto cost card (pricing.CostEntry) + validity
--   * crossborder_pricing_guardrails     singleton: floor margin / hard cap / VAT bps
--   * crossborder_fee_collection_settings singleton: fee-collection strategy A/B/C + sweep
--   * crossborder_refund_fee_policy      singleton: what happens to the fee on refund
-- EXPAND-only (additive): no DROP, no rename, no type narrowing. Re-runnable.
-- Backend-only tables: RLS enabled with no policies; service_role (Go pgx) accesses.
-- All money columns are bigint minor units; rates are integer bps. No floats.

BEGIN;

CREATE TABLE IF NOT EXISTS public.crossborder_fee_rules (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key      uuid        NOT NULL,                 -- stable lineage across versions
  version       integer     NOT NULL CHECK (version >= 1),
  level         smallint    NOT NULL CHECK (level BETWEEN 1 AND 7),
  subject_id    text        NOT NULL DEFAULT '',
  service       text        NOT NULL DEFAULT '',
  direction     text        NOT NULL DEFAULT '',
  corridor      text        NOT NULL DEFAULT '',
  rail          text        NOT NULL DEFAULT '',
  currency      text        NOT NULL DEFAULT '',
  plan          text        NOT NULL DEFAULT '',
  tier          text        NOT NULL DEFAULT '',
  amount_min    bigint      NOT NULL DEFAULT 0 CHECK (amount_min >= 0),
  amount_max    bigint      NOT NULL DEFAULT 0 CHECK (amount_max >= 0),
  flat_minor    bigint      NOT NULL DEFAULT 0 CHECK (flat_minor >= 0),
  pct_bps       bigint      NOT NULL DEFAULT 0 CHECK (pct_bps >= 0),
  min_minor     bigint      NOT NULL DEFAULT 0 CHECK (min_minor >= 0),
  max_minor     bigint      NOT NULL DEFAULT 0 CHECK (max_minor >= 0),
  payer_mode    text        NOT NULL CHECK (payer_mode IN ('FEE_ON_TOP','FEE_INCLUDED','SPLIT')),
  effective_from timestamptz,
  effective_to   timestamptz,
  status        text        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','active','retired','rejected')),
  maker         text        NOT NULL CHECK (maker <> ''),
  checker       text,
  reason        text        NOT NULL DEFAULT '',
  rolled_back_from uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  UNIQUE (rule_key, version),
  -- maker-checker enforced at the data layer too: an active rule has a checker
  -- who is not the maker.
  CONSTRAINT crossborder_fee_rules_maker_checker_ck
    CHECK (status NOT IN ('active') OR (checker IS NOT NULL AND checker <> '' AND lower(checker) <> lower(maker)))
);
CREATE INDEX IF NOT EXISTS crossborder_fee_rules_status_idx
  ON public.crossborder_fee_rules (status, rule_key, version DESC);

CREATE TABLE IF NOT EXISTS public.crossborder_rate_card (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  service     text        NOT NULL DEFAULT '',
  corridor    text        NOT NULL DEFAULT '',
  rail        text        NOT NULL DEFAULT '',
  currency    text        NOT NULL DEFAULT '',
  flat_minor  bigint      NOT NULL DEFAULT 0 CHECK (flat_minor >= 0),
  pct_bps     bigint      NOT NULL DEFAULT 0 CHECK (pct_bps >= 0),
  cost_unknown boolean    NOT NULL DEFAULT false,  -- flag: Verto cost not yet confirmed (never used to price)
  valid_from  timestamptz,
  valid_to    timestamptz,
  source_ref  text        NOT NULL DEFAULT '',     -- Verto rate-card document reference
  created_by  text        NOT NULL DEFAULT '',
  updated_by  text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crossborder_rate_card_sel_idx
  ON public.crossborder_rate_card (service, corridor, rail, currency);

CREATE TABLE IF NOT EXISTS public.crossborder_pricing_guardrails (
  id                 smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  floor_margin_minor bigint      NOT NULL DEFAULT 0 CHECK (floor_margin_minor >= 0),
  floor_margin_bps   bigint      NOT NULL DEFAULT 0 CHECK (floor_margin_bps >= 0),
  hard_cap_bps       bigint      NOT NULL DEFAULT 0 CHECK (hard_cap_bps >= 0),
  hard_cap_minor     bigint      NOT NULL DEFAULT 0 CHECK (hard_cap_minor >= 0),
  tax_bps            bigint      NOT NULL DEFAULT 0 CHECK (tax_bps >= 0),
  updated_by         text        NOT NULL DEFAULT '',
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crossborder_fee_collection_settings (
  id                     smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  strategy               text        NOT NULL DEFAULT 'ledger_charge'
                         CHECK (strategy IN ('ledger_charge','ngn_wallet','spread_baked')),
  sweep_interval_minutes integer     NOT NULL DEFAULT 1440 CHECK (sweep_interval_minutes >= 1),
  sweep_threshold_minor  bigint      NOT NULL DEFAULT 0 CHECK (sweep_threshold_minor >= 0),
  updated_by             text        NOT NULL DEFAULT '',
  updated_at             timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.crossborder_fee_collection_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.crossborder_refund_fee_policy (
  id                 smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  on_failed          text        NOT NULL DEFAULT 'refund' CHECK (on_failed IN ('refund','retain')),
  on_cancelled       text        NOT NULL DEFAULT 'refund' CHECK (on_cancelled IN ('refund','retain')),
  on_customer_refund text        NOT NULL DEFAULT 'retain' CHECK (on_customer_refund IN ('refund','retain')),
  updated_by         text        NOT NULL DEFAULT '',
  updated_at         timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.crossborder_refund_fee_policy (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.crossborder_fee_rules               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crossborder_rate_card               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crossborder_pricing_guardrails      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crossborder_fee_collection_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crossborder_refund_fee_policy       ENABLE ROW LEVEL SECURITY;

-- RBAC: finance.admin.pricing (alongside finance.admin.fx_markup), super/system admin only.
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES (
  'Manage Cross-border Pricing',
  'finance.admin.pricing',
  'finance',
  'pricing',
  'manage',
  'Read and change the cross-border rate card, Platform-Fee schedule (maker-checker), fee-collection settings, refund-fee policy, guardrails, and run the pricing simulator (/api/finance/admin/fx/*)',
  true
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.slug IN ('super-admin', 'system-admin')
  AND p.slug = 'finance.admin.pricing'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
