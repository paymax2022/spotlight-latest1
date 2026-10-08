-- UAT Batch 8 — SEC-005 / G-MC: maker-checker dual control for Contest admin actions.
--
-- Three Contest admin actions currently execute IMMEDIATELY under a single
-- admin's authority, with no second approver:
--   1. Vote reversal        (votes/[voteId]/reverse)      — money-adjacent (wallet refund)
--   2. Vote count adjustment ([contestId]/adjust)          — moves the public leaderboard
--   3. Results publish/lock (rounds/[roundId]/publish-results) — irreversible, assigns prizes
--
-- This mirrors the EXISTING Finance maker-checker pattern (ADR-005,
-- admin_adjustments, 20260616150000_admin_adjustments.sql) rather than
-- inventing a new design: same status lifecycle, same self-approval CHECK
-- constraint, same initiator/checker column shape.
--
-- ONE table for all three action types (not three), matching Finance's
-- single-source-of-truth admin_adjustments design — action_type + a JSONB
-- payload column holds the action-specific params instead of threading
-- pending-state through three different existing tables inconsistently.
--
-- Unlike Finance, there is NO auto-execute threshold here: every one of these
-- three actions ALWAYS requires a second approver, regardless of "size" —
-- there's no clear product basis for a Contest-specific monetary/quantity
-- threshold, and results-publish is irreversible regardless of scale, so
-- simplicity wins (see docs/adr for the ADR-PR<pr-number> covering this batch).
--
-- Payload shapes per action_type (validated at the API layer, not by a DB
-- CHECK — JSONB shape validation lives in application code, same as
-- admin_adjustments' simpler flat-column approach doesn't need this but would
-- if it had per-type payloads):
--   vote_reversal:    { voteId: string, reason: string }
--   vote_adjustment:  { contestId: string, contestantId: string,
--                        adjustmentType: 'add'|'subtract'|'reverse',
--                        voteQuantity: number, reason: string }
--   results_publish:  { roundId: string }
--
-- contest_id is populated from the payload for filtering/display where the
-- payload carries one at insert time (vote_adjustment; results_publish is
-- resolved from the round before insert). It stays NULL for vote_reversal,
-- whose payload only carries voteId — resolving the vote's contest at
-- propose-time would mean an extra read on every propose call for a column
-- that's display-only, so it's left nullable rather than forced.
--
-- Additive only: no DROP, no renames, no type narrowing.

CREATE TABLE IF NOT EXISTS public.contest_admin_approvals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type       TEXT NOT NULL CHECK (action_type IN ('vote_reversal', 'vote_adjustment', 'results_publish')),
  contest_id        UUID, -- populated from the payload for filtering/display; nullable, see header note
  payload           JSONB NOT NULL, -- action-specific params, see header comment for shapes
  status            TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'executed', 'rejected', 'cancelled')),
  initiator_id      UUID NOT NULL REFERENCES public.user_profiles(id),
  initiator_role    TEXT NOT NULL,
  checker_id        UUID REFERENCES public.user_profiles(id),
  checker_role      TEXT,
  checker_note      TEXT,
  checked_at        TIMESTAMPTZ,
  executed_at       TIMESTAMPTZ,
  execution_result  JSONB,
  idempotency_key   TEXT UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_self_approval CHECK (checker_id IS NULL OR checker_id <> initiator_id)
);

CREATE INDEX IF NOT EXISTS idx_contest_admin_approvals_status ON public.contest_admin_approvals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contest_admin_approvals_contest_id ON public.contest_admin_approvals (contest_id) WHERE contest_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS — internal admin workflow, no public read (unlike contest_prizes /
-- voting_round_results, which are public-facing). Admin-only manage, mirroring
-- the admin-role-gated policy style from 20270213000000_contest_prizes_and_results_lock.sql
-- and 20260405700000_contest_image_templates.sql.
-- ---------------------------------------------------------------------------
ALTER TABLE public.contest_admin_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_manage_contest_admin_approvals" ON public.contest_admin_approvals;
CREATE POLICY "admin_manage_contest_admin_approvals"
ON public.contest_admin_approvals FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
);
