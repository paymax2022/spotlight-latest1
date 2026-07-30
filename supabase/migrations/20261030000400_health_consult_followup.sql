-- TM-008: follow-up scheduling from a consult.
--
-- A follow-up is a NEW consult linked back to the consult it follows, optionally
-- fulfilling a referral generated on that consult (TM-007). These links let a
-- patient's care thread be followed end to end.
--
-- ADDITIVE-ONLY: two nullable self/FK columns on health_consults; existing rows
-- keep both NULL (i.e. not a follow-up). No DROP, no rename, no type change.

ALTER TABLE public.health_consults
  ADD COLUMN IF NOT EXISTS parent_consult_id uuid REFERENCES public.health_consults(id) ON DELETE SET NULL;

ALTER TABLE public.health_consults
  ADD COLUMN IF NOT EXISTS referral_id uuid REFERENCES public.health_consult_referrals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_health_consults_parent ON public.health_consults (parent_consult_id);
