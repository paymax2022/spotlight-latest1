-- Refer & Earn modification (Module 8 spec sign-off, 2026-09-18): Admin as the
-- default referrer, signup/KYC points, and a lifetime 100-commission-event cap
-- per referral code with an Admin handoff after the cap. Reuses the EXISTING
-- Direct Referral Rewards engine's tiered rate (5/8/12/15%) and referral_links
-- code table unchanged — this migration does NOT introduce a new flat rate or a
-- new/competing code table (see ADR for why: two prior referral engines already
-- conflicted this way once, tracked as REF-002 in SPOTLIGHT_UAT_BUG_TRACKER.md).
--
-- ADDITIVE ONLY: no DROP TABLE/COLUMN/TYPE, no RENAME, no type narrowing.
-- The one CHECK-constraint widen below (attribution_type) is a documented
-- exception used elsewhere in this migration family (see referral_core's own
-- "DROP POLICY IF EXISTS ... idempotent" precedent) — it only ADDS an allowed
-- value, never removes one, and no existing row's value becomes invalid.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Widen referral_attributions.attribution_type to allow 'admin_default' —
--    a signup with no code (or an invalid/self-referral code) now gets a REAL
--    attribution row pointing at the platform's Admin user, instead of no
--    attribution row at all. is_house stays FALSE for these rows: Admin here is
--    a normal earning referrer for this engine's purposes, not the separate
--    non-withdrawable notional house-ledger concept in referral_house_accounts.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.referral_attributions
  DROP CONSTRAINT IF EXISTS referral_attributions_attribution_type_check;
ALTER TABLE public.referral_attributions
  ADD CONSTRAINT referral_attributions_attribution_type_check
  CHECK (attribution_type IN
    ('code','deeplink','context','regional_house','global_house','admin_default'));

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Signup / KYC points ledger — non-cash points, separate from the reward-kobo
--    money path (referral_rewards) and from the unrelated mission/streak points
--    system in referral_gamification.*. idempotency_key makes each award a
--    write-once event (one signup award and one KYC-update award per user).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_signup_points (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event           text NOT NULL CHECK (event IN ('signup','kyc_update')),
  points          int NOT NULL CHECK (points > 0),
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_signup_points_user
  ON public.referral_signup_points (user_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Commission cap — one row per referrer (== per referral code, since
--    referral_links.referrer_id is UNIQUE). commission_events_used counts
--    purchase events that were credited to THIS referrer across every user
--    referred by their code (not per referred user). Capped permanently once it
--    reaches 100 — capped_at is set once and never cleared, including on a
--    refund of a prior event (see ADR: a refund reverses the wallet credit, but
--    does not give the slot back or un-cap the code).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_commission_caps (
  referrer_id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  commission_events_used  int NOT NULL DEFAULT 0 CHECK (commission_events_used >= 0 AND commission_events_used <= 100),
  capped_at               timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. referral_rewards gains two additive columns: payee_id (who actually got
--    credited — the referrer, or Admin once the code is capped) and capped
--    (whether the cap was already reached when this event was processed).
--    referrer_id keeps meaning "whose code this is" for every existing report
--    that already reads it; payee_id is new and nullable so no backfill is
--    required for existing rows (defaults payee_id = referrer_id via the
--    application, never via a bulk UPDATE here, to keep this migration a pure
--    schema change).
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.referral_rewards
  ADD COLUMN IF NOT EXISTS payee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.referral_rewards
  ADD COLUMN IF NOT EXISTS capped boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_referral_rewards_payee
  ON public.referral_rewards (payee_id, created_at DESC);

COMMIT;
