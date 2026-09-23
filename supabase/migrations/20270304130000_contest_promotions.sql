-- Contest Promotion Phase 1 (4/6) — contest_promotions audit table.
--
-- One row per contestant promoted (or proposed for promotion) from a child
-- contest into its parent. Mirrors the STYLE of the eviction audit trail
-- (contestant_evictions, 20260807000000_voting_contest_stages_eviction.sql)
-- without touching that system at all — this is a new, unrelated table.
--
-- contestant_id / new_contestant_id reference public.contestants(id), the real
-- roster table backing the voting module (20260404220000_create_contestants.sql,
-- extended by 20261223000000_connect_contests_bridge.sql's connect_contest_id
-- column). child_contest_id / parent_contest_id reference public.contests(id)
-- (the legacy plane FK target, same choice voting_round_results makes —
-- see 20270213000000_contest_prizes_and_results_lock.sql).
--
-- Additive only: no DROP, no renames, no type narrowing.

CREATE TABLE IF NOT EXISTS public.contest_promotions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_contest_id   UUID NOT NULL REFERENCES public.contests(id),
  parent_contest_id  UUID NOT NULL REFERENCES public.contests(id),
  contestant_id      UUID NOT NULL REFERENCES public.contestants(id),
  rank_in_child      INTEGER NOT NULL CHECK (rank_in_child > 0),
  requested_by       UUID NOT NULL REFERENCES auth.users(id),
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by        UUID REFERENCES auth.users(id),
  approved_at        TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'rejected', 'executed')),
  new_contestant_id  UUID REFERENCES public.contestants(id),
  rejection_reason   TEXT,
  UNIQUE (child_contest_id, parent_contest_id, contestant_id),
  CONSTRAINT contest_promotions_no_self_promote CHECK (child_contest_id <> parent_contest_id),
  CONSTRAINT contest_promotions_no_self_approval CHECK (approved_by IS NULL OR approved_by <> requested_by)
);

CREATE INDEX IF NOT EXISTS idx_contest_promotions_status
  ON public.contest_promotions (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_contest_promotions_child_contest_id
  ON public.contest_promotions (child_contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_promotions_parent_contest_id
  ON public.contest_promotions (parent_contest_id);

-- RLS — internal admin workflow, same posture as contest_admin_approvals
-- (admin-only manage, no public read).
ALTER TABLE public.contest_promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_manage_contest_promotions" ON public.contest_promotions;
CREATE POLICY "admin_manage_contest_promotions"
ON public.contest_promotions FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
);

COMMENT ON TABLE public.contest_promotions IS
  'Maker-checker audit trail for promoting a child contest''s top-N contestants '
  'into its parent contest. One row per contestant. requested_by proposes; a '
  'DIFFERENT admin (approved_by) must approve before new_contestant_id is '
  'created and status flips to executed — enforced both by the '
  'contest_promotions_no_self_approval CHECK here and by RequestPromotion / '
  'ApprovePromotion in backend/internal/connect/voting.';
