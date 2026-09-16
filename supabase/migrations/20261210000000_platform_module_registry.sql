-- Platform module registry: admin-controlled publication per environment.
-- Additive-only — no DROP, no RENAME, no type narrowing.
--
-- WHY: module visibility is currently an env var (FEATURE_*_ENABLED) read from
-- process.env. Changing one means editing a Railway variable and redeploying, so
-- "ship the code dark, publish when ready" is not expressible: a module is either
-- built into the deploy and on, or off for everyone including development.
--
-- This registry separates the two questions:
--   • CAN this deployment run the module at all?  → the env flag (ops kill switch)
--   • SHOULD this environment show it to users?    → this table (admin decision)
--
-- Effective visibility is the AND of both, computed server-side. The env flag is
-- never overridden — an ops kill switch must stay a kill switch, so publishing a
-- module here can never resurrect one that ops has turned off.

CREATE TABLE IF NOT EXISTS public.platform_modules (
    key         TEXT PRIMARY KEY CHECK (key ~ '^[a-zA-Z][a-zA-Z0-9]*$'),
    name        TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'platform',
    env_flag    TEXT,
    description TEXT,
    -- Lifecycle is module-wide. 'archived' hides the module in EVERY environment
    -- regardless of per-environment status: the source stays, the surface goes.
    lifecycle   TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','archived')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-environment publication. A missing row means NOT visible (fail-closed), so
-- a newly registered module is invisible everywhere until someone publishes it.
CREATE TABLE IF NOT EXISTS public.platform_module_environments (
    module_key  TEXT NOT NULL REFERENCES public.platform_modules(key) ON DELETE CASCADE,
    environment TEXT NOT NULL CHECK (environment IN ('development','staging','production')),
    status      TEXT NOT NULL DEFAULT 'hidden' CHECK (status IN ('hidden','visible')),
    note        TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID REFERENCES auth.users(id),
    PRIMARY KEY (module_key, environment)
);

CREATE INDEX IF NOT EXISTS platform_module_env_lookup_idx
    ON public.platform_module_environments (environment, status);

-- Immutable audit of every publication decision. Append-only by policy: the API
-- only ever INSERTs, and "who turned this off in production" must survive a later
-- change to the same row.
CREATE TABLE IF NOT EXISTS public.platform_module_audit (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_key  TEXT NOT NULL,
    environment TEXT,
    action      TEXT NOT NULL CHECK (action IN ('publish','hide','archive','restore')),
    before_val  TEXT,
    after_val   TEXT NOT NULL,
    note        TEXT,
    actor_id    UUID REFERENCES auth.users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_module_audit_module_idx
    ON public.platform_module_audit (module_key, created_at DESC);

-- ─── Seed: the modules that exist today ──────────────────────────────────────
-- Generated from frontend-web/src/lib/feature-flags.ts, the current source of
-- truth for what a "module" is. ON CONFLICT DO NOTHING so re-running never
-- clobbers an admin's edits to name/category/description.
INSERT INTO public.platform_modules (key, name, category, env_flag, description) VALUES
  ('wallet', 'Wallet', 'finance', 'FEATURE_WALLET_ENABLED', 'EPIC 1 & 3 — Wallet, ledger, topup, virtual accounts'),
  ('kyc', 'Kyc', 'finance', 'FEATURE_KYC_ENABLED', 'EPIC 2 — KYC tiers and document verification'),
  ('virtualAccounts', 'Virtual Accounts', 'finance', 'FEATURE_VIRTUAL_ACCOUNTS_ENABLED', 'EPIC 3 — Paystack Dedicated Virtual Account auto-provisioning'),
  ('votesBridge', 'Votes Bridge', 'voting', 'VOTES_BRIDGE_ENABLED', 'EPIC 4 — Vote bridge: idempotency fix + KYC gate on vote paths'),
  ('referrals', 'Referrals', 'growth', 'FEATURE_REFERRALS_ENABLED', 'EPIC 5 — Referral codes and ledger rewards'),
  ('insurance', 'Insurance', 'finance', 'FEATURE_INSURANCE_ENABLED', 'Micro-insurance / Protection module (MyCover + Octamile via gateway)'),
  ('stays', 'Stays', 'commerce', 'FEATURE_STAYS_ENABLED', 'Hotel Booking / Stays module (Property Suite, dual-rail supply gateway)'),
  ('events', 'Events', 'commerce', 'FEATURE_EVENTS_ENABLED', 'Top-5 expansion modules (no-new-licence; existing wallet/ledger rails)'),
  ('socialPay', 'Social Pay', 'social', 'FEATURE_SOCIAL_PAY_ENABLED', 'Social Pay module'),
  ('savings', 'Savings', 'finance', 'FEATURE_SAVINGS_ENABLED', 'Savings module'),
  ('creators', 'Creators', 'growth', 'FEATURE_CREATORS_ENABLED', 'Creators module'),
  ('loyalty', 'Loyalty', 'growth', 'FEATURE_LOYALTY_ENABLED', 'Loyalty module'),
  ('health', 'Health', 'health', 'FEATURE_HEALTH_ENABLED', 'Health verticals (marketplace; licensed partners deliver care)'),
  ('healthPharmacy', 'Health Pharmacy', 'health', 'FEATURE_HEALTH_PHARMACY_ENABLED', 'Health Pharmacy module'),
  ('healthLab', 'Health Lab', 'health', 'FEATURE_HEALTH_LAB_ENABLED', 'Health Lab module'),
  ('healthVet', 'Health Vet', 'health', 'FEATURE_HEALTH_VET_ENABLED', 'Health Vet module'),
  ('fintechAdmin', 'Fintech Admin', 'finance', 'FEATURE_FINTECH_ADMIN_ENABLED', 'EPIC 6 — Fintech admin RBAC (maker-checker)'),
  ('tierLimits', 'Tier Limits', 'finance', 'FEATURE_TIER_LIMITS_ENABLED', 'Block 7 — Per-tier daily wallet and vote limits (fail-closed enforcement)'),
  ('checkoutTopupTier0', 'Checkout Topup Tier0', 'finance', 'FEATURE_CHECKOUT_TOPUP_TIER0', 'ADR-042 — let an UNVERIFIED (Tier 0) account pay by card at checkout, under a capped rolling allowance, instead of being refused outright. This relaxes a KYC gate, so it defaults o'),
  ('utilityPayments', 'Utility Payments', 'finance', 'FEATURE_UTILITY_PAYMENTS_ENABLED', 'Utility bills engine — provider routing, wallet debit, receipts'),
  ('walletTransfers', 'Wallet Transfers', 'finance', 'FEATURE_WALLET_TRANSFERS_ENABLED', 'Block 10 — Paymax-to-Paymax instant wallet transfer'),
  ('walletBankTransfers', 'Wallet Bank Transfers', 'finance', 'FEATURE_BANK_TRANSFERS_ENABLED', 'Block 11 — Wallet-to-bank account transfer via Paystack Transfers'),
  ('beneficiaries', 'Beneficiaries', 'finance', 'FEATURE_BENEFICIARIES_ENABLED', 'Block 12 — Saved beneficiaries for repeat bank transfers'),
  ('groups', 'Groups', 'community', 'FEATURE_GROUPS_ENABLED', 'P3 Lane B — Community groups with wallet-backed dues payments'),
  ('estate', 'Estate', 'community', 'FEATURE_ESTATE_ENABLED', 'P3 Lane D — Estate access control and private elections'),
  ('crowdfunding', 'Crowdfunding', 'community', 'FEATURE_CROWDFUNDING_ENABLED', 'P3 Lane E — Crowdfunding campaigns with escrow and goal tracking'),
  ('restaurant', 'Restaurant', 'commerce', 'FEATURE_RESTAURANT_ENABLED', 'P3 Lane F — Restaurant and food delivery with rider dispatch'),
  ('telemedicine', 'Telemedicine', 'health', 'FEATURE_TELEMEDICINE_ENABLED', 'P3 Lane G — Telemedicine: doctors, appointments, prescriptions'),
  ('transport', 'Transport', 'mobility', 'FEATURE_TRANSPORT_ENABLED', 'Transport — ride-hailing: drivers, trips, fare settlement'),
  ('aiCare', 'Ai Care', 'ops', 'FEATURE_AICARE_ENABLED', 'AI Customer Care — chat sessions, AI reply, escalation to agent'),
  ('voteBridge', 'Vote Bridge', 'voting', 'FEATURE_VOTE_BRIDGE_ENABLED', 'P3 Lane H — Wallet-paid votes via Go vote-bridge debit endpoint'),
  ('fx', 'Fx', 'finance', 'FEATURE_FX_ENABLED', 'FX currency exchange via Maplerad'),
  ('realtor', 'Realtor', 'property', 'FEATURE_REALTOR_ENABLED', 'Realtor — property graph, listings, inspections, leases, shortlet, AI assist'),
  ('disputes', 'Disputes', 'ops', 'FEATURE_DISPUTES_ENABLED', 'Dispute management — users raise tickets; admin resolves'),
  ('ratings', 'Ratings', 'ops', 'FEATURE_RATINGS_ENABLED', 'Post-transaction ratings for doctors, riders, restaurants, etc.'),
  ('association', 'Association', 'community', 'FEATURE_ASSOCIATION_ENABLED', 'Group / Association membership — dues, directory, meetings, chat, AI notes')
ON CONFLICT (key) DO NOTHING;

-- Every seeded module starts VISIBLE IN DEVELOPMENT ONLY. That reproduces today's
-- developer experience (build it, see it locally) while making production opt-in —
-- which is the whole point of the registry. Nothing becomes newly visible in
-- production as a result of this migration.
INSERT INTO public.platform_module_environments (module_key, environment, status)
SELECT m.key, 'development', 'visible' FROM public.platform_modules m
ON CONFLICT (module_key, environment) DO NOTHING;

INSERT INTO public.platform_module_environments (module_key, environment, status)
SELECT m.key, e.env, 'hidden'
  FROM public.platform_modules m
  CROSS JOIN (VALUES ('staging'), ('production')) AS e(env)
ON CONFLICT (module_key, environment) DO NOTHING;

COMMENT ON TABLE public.platform_modules IS
    'Module registry. Effective visibility = env FEATURE_* flag AND lifecycle=active AND platform_module_environments.status=visible for the running environment.';

-- ─── RBAC ────────────────────────────────────────────────────────────────────
-- Publishing a module changes what every user of an environment can see, so it is
-- its own permission rather than folded into a general admin role.
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Read Module Registry',   'platform.modules.read',   'platform', 'modules', 'read',   'View the module registry and per-environment publication state', true),
  ('Manage Module Registry', 'platform.modules.manage', 'platform', 'modules', 'manage', 'Publish, hide, archive or restore a module for an environment', true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (
  SELECT id FROM public.permissions WHERE slug IN ('platform.modules.read','platform.modules.manage')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
WHERE EXISTS (SELECT 1 FROM public.roles WHERE slug = 'super-admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (
  SELECT id FROM public.permissions WHERE slug IN ('platform.modules.read','platform.modules.manage')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
WHERE EXISTS (SELECT 1 FROM public.roles WHERE slug = 'system-admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;
