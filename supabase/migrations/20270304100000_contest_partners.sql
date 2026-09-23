-- Contest Promotion Phase 1 (1/6) — contest_partners.
--
-- A partner organisation (e.g. "Golibe") that runs its own child contest under
-- a Spotlight parent/"mother" contest (see 20270304010000_contest_hierarchy_columns.sql
-- for the parent/child link itself). No partner-organisation concept existed
-- anywhere in the repo before this (confirmed via grep for
-- partner_org|partner_id|partnership) — built fresh here.
--
-- Additive only: no DROP, no renames, no type narrowing.

CREATE TABLE IF NOT EXISTS public.contest_partners (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  logo_url      TEXT,
  notes         TEXT,
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contest_partners_name ON public.contest_partners (name);

CREATE OR REPLACE FUNCTION public.set_contest_partners_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contest_partners_updated_at ON public.contest_partners;
CREATE TRIGGER trg_contest_partners_updated_at
  BEFORE UPDATE ON public.contest_partners
  FOR EACH ROW EXECUTE FUNCTION public.set_contest_partners_updated_at();

-- RLS — internal admin resource, mirrors contest_admin_approvals' admin-only
-- manage policy style (20270214000000_contest_admin_approvals.sql).
ALTER TABLE public.contest_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_manage_contest_partners" ON public.contest_partners;
CREATE POLICY "admin_manage_contest_partners"
ON public.contest_partners FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
);
