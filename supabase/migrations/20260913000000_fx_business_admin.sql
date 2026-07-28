-- ── FX Business Admin console ────────────────────────────────────────────────
-- Additive-only migration graduating the FX "business admin" console from honest
-- stubs (internal/orchestration handler_business.go) to real persistence:
-- team members, money-approval workflow + thresholds, activity/audit log,
-- API keys (hash-only), webhook subscriptions, per-account settings, and the
-- notification inbox.
--
-- Tenant model: there is no separate `businesses` table in this codebase — the FX
-- account owner (the authenticated customer / user_id) IS the business/tenant.
-- Every row is therefore scoped by `business_id` = the owner's customer id, and
-- object-level authZ is enforced in Go by filtering every query on business_id
-- (the backend uses the service-role pgx pool, same pattern as all orch_* tables).
--
-- IRON RULES honoured: kobo int64 (amount_minor bigint); additive-only (no DROP,
-- no column rename, no type narrowing); secrets stored hashed only (API keys keep
-- a sha-256 hash + a non-secret display prefix, never the plaintext). NOT
-- money-path: no ledger rows here — approvals persist a *decision* only; the money
-- move stays on the transfer/conversion path.

-- ─── Team members ─────────────────────────────────────────────────────────────
-- RBAC seats under one business. role ∈ OWNER|ADMIN|APPROVER|INITIATOR|VIEWER,
-- status ∈ ACTIVE|INVITED|SUSPENDED. One row per (business, email).
CREATE TABLE IF NOT EXISTS orch_fx_team_members (
    id             text PRIMARY KEY,
    business_id    text NOT NULL,              -- owning account (customer/user id)
    member_user_id text,                       -- linked auth user once accepted (nullable while INVITED)
    name           text NOT NULL,
    email          text NOT NULL,
    role           text NOT NULL DEFAULT 'VIEWER',
    status         text NOT NULL DEFAULT 'INVITED',
    last_active_at timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS orch_fx_team_members_business_email_idx
    ON orch_fx_team_members (business_id, lower(email));
CREATE INDEX IF NOT EXISTS orch_fx_team_members_business_idx
    ON orch_fx_team_members (business_id, created_at DESC);

-- ─── Approval thresholds ──────────────────────────────────────────────────────
-- Above `amount_minor` (in `currency`) a matching request needs `approvers_required`
-- approvals before it may execute.
CREATE TABLE IF NOT EXISTS orch_fx_approval_thresholds (
    id                 text PRIMARY KEY,
    business_id        text NOT NULL,
    label              text NOT NULL,
    currency           text NOT NULL DEFAULT 'NGN',
    amount_minor       bigint NOT NULL DEFAULT 0,   -- kobo/cents; above this needs approval
    approvers_required int  NOT NULL DEFAULT 1,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orch_fx_approval_thresholds_business_idx
    ON orch_fx_approval_thresholds (business_id, created_at DESC);

-- ─── Approvals (money-approval workflow) ──────────────────────────────────────
-- A pending high-value transfer/conversion/bulk_payout awaiting a decision.
-- status ∈ PENDING|APPROVED|REJECTED. Persists the DECISION + who/when only; the
-- actual value movement stays on the transfer/conversion money path (no ledger here).
CREATE TABLE IF NOT EXISTS orch_fx_approvals (
    id             text PRIMARY KEY,
    business_id    text NOT NULL,
    type           text NOT NULL,              -- transfer | conversion | bulk_payout
    reference      text NOT NULL,
    amount_minor   bigint NOT NULL DEFAULT 0,  -- kobo/cents
    currency       text NOT NULL DEFAULT 'NGN',
    destination    text NOT NULL DEFAULT '',   -- beneficiary / corridor summary
    initiator      text NOT NULL DEFAULT '',
    threshold_minor bigint NOT NULL DEFAULT 0, -- minor units that triggered approval
    status         text NOT NULL DEFAULT 'PENDING',
    decided_by     text,                       -- user id of the approver/rejecter
    decided_at     timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orch_fx_approvals_business_idx
    ON orch_fx_approvals (business_id, created_at DESC);

-- ─── Activity / audit log ─────────────────────────────────────────────────────
-- Append-only projection of business-admin actions (member/role changes, approval
-- decisions, key rotations, threshold + webhook + settings edits). Immutable in
-- practice: handlers only INSERT and SELECT here — this IS the audit trail.
CREATE TABLE IF NOT EXISTS orch_fx_activity_log (
    id          text PRIMARY KEY,
    business_id text NOT NULL,
    actor       text NOT NULL DEFAULT '',      -- display name / user id of the actor
    action      text NOT NULL,                 -- human label
    target      text,                          -- affected entity label (nullable)
    kind        text NOT NULL DEFAULT 'config',-- auth | payout | config | approval | security
    at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orch_fx_activity_log_business_idx
    ON orch_fx_activity_log (business_id, at DESC);

-- ─── API keys (hash-only) ─────────────────────────────────────────────────────
-- SECRET-SAFE: we NEVER store the plaintext key. `key_hash` is sha-256(plaintext),
-- `prefix` is a short non-secret display fragment (e.g. 'sk_live_8x21'). The
-- plaintext is returned exactly once on create/rotate and then unrecoverable.
CREATE TABLE IF NOT EXISTS orch_fx_api_keys (
    id          text PRIMARY KEY,
    business_id text NOT NULL,
    label       text NOT NULL,
    prefix      text NOT NULL,                 -- non-secret display fragment
    key_hash    text NOT NULL,                 -- sha-256 hex of the plaintext (never the secret)
    mode        text NOT NULL DEFAULT 'sandbox', -- live | sandbox
    last_used   timestamptz,
    revoked_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orch_fx_api_keys_business_idx
    ON orch_fx_api_keys (business_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS orch_fx_api_keys_hash_idx
    ON orch_fx_api_keys (key_hash);

-- ─── Webhook subscriptions ────────────────────────────────────────────────────
-- Per-business outbound webhook endpoints. `events` is the subscribed event list.
CREATE TABLE IF NOT EXISTS orch_fx_webhooks (
    id          text PRIMARY KEY,
    business_id text NOT NULL,
    url         text NOT NULL,
    events      text[] NOT NULL DEFAULT '{}',
    enabled     boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orch_fx_webhooks_business_idx
    ON orch_fx_webhooks (business_id, created_at DESC);

-- ─── Settings (one row per business) ──────────────────────────────────────────
-- Notification prefs + stablecoin addresses are stored as JSONB blobs to mirror
-- the FxSettings contract without a rigid column-per-flag schema.
CREATE TABLE IF NOT EXISTS orch_fx_settings (
    business_id         text PRIMARY KEY,
    default_currency    text NOT NULL DEFAULT 'NGN',
    display_rate        text NOT NULL DEFAULT 'all_in', -- mid | all_in
    language            text NOT NULL DEFAULT 'English',
    theme               text NOT NULL DEFAULT 'system', -- system | light | dark
    biometric_enabled   boolean NOT NULL DEFAULT false,
    two_factor_enabled  boolean NOT NULL DEFAULT false,
    notifications       jsonb NOT NULL DEFAULT '{"payouts":true,"conversions":true,"collections":true,"rateAlerts":true,"security":true,"approvals":true}'::jsonb,
    stablecoin_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ─── Notifications inbox ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orch_fx_notifications (
    id          text PRIMARY KEY,
    business_id text NOT NULL,
    kind        text NOT NULL DEFAULT 'security', -- rate_alert|conversion|payout|collection|card|approval|verification|security
    title       text NOT NULL,
    body        text NOT NULL DEFAULT '',
    deeplink    text,
    read        boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orch_fx_notifications_business_idx
    ON orch_fx_notifications (business_id, created_at DESC);

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- The Go backend reaches these tables through the service-role pgx pool (RLS is
-- bypassed for service-role, exactly like every other orch_* table), and enforces
-- business scoping in application code. We still enable RLS with a deny-by-default
-- posture so that any accidental access via an anon/authenticated Supabase client
-- (which does NOT carry the service role) is blocked — defense in depth. No
-- permissive policy is added: without the service role, these tables are invisible.
ALTER TABLE orch_fx_team_members         ENABLE ROW LEVEL SECURITY;
ALTER TABLE orch_fx_approval_thresholds  ENABLE ROW LEVEL SECURITY;
ALTER TABLE orch_fx_approvals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE orch_fx_activity_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE orch_fx_api_keys             ENABLE ROW LEVEL SECURITY;
ALTER TABLE orch_fx_webhooks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE orch_fx_settings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE orch_fx_notifications        ENABLE ROW LEVEL SECURITY;
