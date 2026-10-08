-- Paymax Marketplace — MKT-007: Users/Trust&Safety admin, Appeals, Fraud signals.
-- Additive-only (CLAUDE.md iron rule: no DROP, no renames, no type narrowing).
--
-- Status/vocab is verified against frontend-admin/src/types/marketplaceAdmin.ts
-- (the authoritative contract — NOT the older USE_FIXTURES blocks in
-- marketplaceAdminService.ts, which are a partial/stale subset):
--   MktUserStatus  = 'active' | 'suspended' | 'banned'
--   MktUserAction  = 'suspend' | 'ban' | 'reinstate'
--   MktAppealStatus     = 'opened' | 'under_review' | 'decided' | 'executed' | 'closed'
--   MktAppealTargetType = 'listing' | 'boost' | 'user'
--   MktAppealDecision   = 'upheld' | 'overturned' (stored); request verb is 'uphold'/'overturn'
--
-- RBAC: gated by slugs already seeded in
--   20261028000300_marketplace_users_ts_rbac_perms.sql (.users.view / .users.action)
--   20261028000200_marketplace_appeals_rbac_perms.sql  (.appeals.review / .appeals.decide)
-- Both migrations' own comments document GET /admin/fraud/signals as gated on
-- .users.view and ban/appeal-overturn as maker-checker on .users.action /
-- .appeals.decide — no new permission slug is introduced here (verified live:
-- `SELECT slug FROM permissions WHERE slug LIKE 'marketplace.admin%'`).
--
-- Maker-checker mechanism: the pure four-eyes primitive in
-- backend/internal/health/makercheck/makercheck.go (Authorize/Approve/Consume) is
-- reused verbatim in the Go service layer for both flows below (see
-- service_admin_users.go / service_admin_appeals.go). This migration adds the
-- SAME defense-in-depth CHECK constraint pattern ADR-005
-- (docs/adr/ADR-005-maker-checker.md) uses for wallet adjustments —
-- second_approver_id <> the proposer — as a second, DB-level line of defense
-- independent of the Go-layer check, mirroring the column naming this module
-- already uses for the same pattern on disputes (mkt_disputes.decided_by /
-- second_approver_id / requires_dual_approval — see repository.go disputeCols).
--
-- Severity split (both tables): only the highest-severity action is
-- dual-approval — a user 'ban' and an appeal 'overturn'. Suspend/reinstate and
-- an appeal 'uphold' execute immediately under a single admin (see
-- service_admin_users.go dualApprovalRequiredFor / repository_admin_appeals.go
-- ProposeAppealDecision doc comments for the reasoning).

BEGIN;

-- ─── mkt_user_moderation ──────────────────────────────────────────────────────
-- One row per (user_id, market_id): marketplace-scoped moderation state for a
-- seller/buyer. Deliberately NOT a column on platform_users — platform_users is
-- core/legacy auth infra outside this module's ownership (CLAUDE.md brownfield
-- rule); this table is additive and fully owned by marketplace. A user with no
-- row is presumed status='active', kyc_pending=false, nothing pending.
CREATE TABLE IF NOT EXISTS public.mkt_user_moderation (
  user_id                 uuid        NOT NULL,
  market_id               text        NOT NULL DEFAULT 'NG',
  status                  text        NOT NULL DEFAULT 'active'
                                       CHECK (status IN ('active','suspended','banned')),
  suspension_reason_code  text,
  blacklisted             boolean     NOT NULL DEFAULT false,
  blacklist_reason_code   text,
  blacklisted_by          uuid,
  blacklisted_at          timestamptz,
  kyc_tier                text        NOT NULL DEFAULT 'tier0_browse'
                                       CHECK (kyc_tier IN ('tier0_browse','tier1_buy','tier2_sell','tier3_business')),
  kyc_pending             boolean     NOT NULL DEFAULT false,

  -- Pending (maker) proposal — NULL when nothing is awaiting approval. Only
  -- 'ban' is ever dual-approval; suspend/reinstate execute immediately and
  -- never populate these columns.
  pending_action          text        CHECK (pending_action IS NULL OR pending_action IN ('suspend','ban','reinstate')),
  pending_reason_code     text,
  proposed_by             uuid,
  proposed_at             timestamptz,
  requires_dual_approval  boolean     NOT NULL DEFAULT false,

  -- Checker stamp — written BEFORE the status mutation is applied (ADR-005
  -- "checker stamps before execution" ordering), so the audit trail survives
  -- even if execution fails partway.
  second_approver_id      uuid,
  second_approved_at      timestamptz,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, market_id),
  -- Defense-in-depth: even if the Go-layer makercheck.Authorize check were ever
  -- bypassed by a bug, the DB itself refuses to record a self-approval.
  CONSTRAINT mkt_user_moderation_no_self_approve
    CHECK (second_approver_id IS NULL OR proposed_by IS NULL OR second_approver_id <> proposed_by)
);

CREATE INDEX IF NOT EXISTS idx_user_moderation_pending
  ON public.mkt_user_moderation (market_id) WHERE pending_action IS NOT NULL;

ALTER TABLE public.mkt_user_moderation ENABLE ROW LEVEL SECURITY;
-- No policies: mirrors every other mkt_admin_* / mkt_flags table in this module
-- (RLS enabled, zero policies -> backend-service-role-only).

-- ─── mkt_blacklist ─────────────────────────────────────────────────────────────
-- Blacklisted identifiers (device/phone/ip/email). Kept as its own table (rather
-- than folded into mkt_user_moderation) because a blacklist entry is an
-- identifier-level fact, not always tied to one user_id at write time.
CREATE TABLE IF NOT EXISTS public.mkt_blacklist (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  type          text        NOT NULL CHECK (type IN ('device','phone','ip','email')),
  value         text        NOT NULL,
  reason_code   text        NOT NULL,
  created_by    uuid        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (type, value)
);

ALTER TABLE public.mkt_blacklist ENABLE ROW LEVEL SECURITY;

-- ─── mkt_appeals ───────────────────────────────────────────────────────────────
-- A seller/buyer appealing a moderation decision (rejected listing, flag action,
-- ban). Filed by the member themselves (POST /v1/marketplace/appeals, member
-- auth, no RBAC — createAppeal has no admin-only gate in the frontend service
-- layer and no admin call site) OR opened by an admin on a member's behalf;
-- reviewed/decided by admins.
--
-- decide() is maker-checker ONLY for an 'overturn' (reverses a prior
-- enforcement action against a real account) — NOT for an 'uphold' (denies the
-- appeal; the original action already stands, nothing new executes).
CREATE TABLE IF NOT EXISTS public.mkt_appeals (
  id                     uuid        NOT NULL DEFAULT gen_random_uuid(),
  market_id              text        NOT NULL DEFAULT 'NG',
  appellant_id           uuid        NOT NULL,
  target_type            text        NOT NULL CHECK (target_type IN ('listing','boost','user')),
  target_id              uuid        NOT NULL,
  original_action        text        NOT NULL,   -- e.g. 'removed_policy','rejected_with_reason','suspended'
  original_reason_code   text        NOT NULL,
  appellant_note         text        NOT NULL,
  status                 text        NOT NULL DEFAULT 'opened'
                                      CHECK (status IN ('opened','under_review','decided','executed','closed')),

  -- Proposed (maker) decision.
  decision               text        CHECK (decision IS NULL OR decision IN ('upheld','overturned')),
  decision_notes         text,
  decided_by             uuid,
  decided_at             timestamptz,

  -- Checker stamp (overturn only).
  second_approver_id     uuid,
  second_approved_at     timestamptz,
  requires_dual_approval boolean     NOT NULL DEFAULT false,

  executed_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  CONSTRAINT mkt_appeals_no_self_approve
    CHECK (second_approver_id IS NULL OR decided_by IS NULL OR second_approver_id <> decided_by)
);

CREATE INDEX IF NOT EXISTS idx_appeals_market_status ON public.mkt_appeals (market_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_appeals_appellant ON public.mkt_appeals (appellant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_appeals_target ON public.mkt_appeals (target_type, target_id);

ALTER TABLE public.mkt_appeals ENABLE ROW LEVEL SECURITY;
-- No policies: backend-service-role-only, same posture as mkt_flags/mkt_disputes.

COMMIT;
