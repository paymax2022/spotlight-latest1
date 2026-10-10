-- Paymax Health — lab staff affiliation (HL-2). Ref: docs/adr/ADR-PR640.
--
-- WHY
-- The single-identity capability model (health_providers is UNIQUE on
-- (owner_user_id, domain, provider_type)) records that a user IS an approved
-- lab_scientist / phlebotomist — it names no employing lab. "Staff of THIS
-- lab" therefore had no schema answer, and the interim gate resolved every
-- staff check to the lab's owner alone: a real lab's bench scientists and
-- field phlebotomists could not collect samples, enter results, or sign off
-- releases for the lab they actually work at.
--
-- A grant is per (lab_provider_id, user_id), modeled after
-- restaurant_staff (20261212000000_restaurant_staff.sql): authority follows
-- the lab, not the credential. The verified lab owner writes the grant; the
-- lab service reads ACTIVE rows only. 'scientist' covers bench work and the
-- HL-7 result sign-off; 'phlebotomist' covers collection + custody work.
--
-- SAFETY
-- Additive-only per CLAUDE.md: a new table, indexes, and RLS — no change to
-- health_providers, lab_orders, or any money column. Nothing here moves
-- funds; this gates actor authorization only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lab_staff (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_provider_id uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('scientist','phlebotomist')),
  status          text NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','SUSPENDED','REMOVED')),
  -- The lab owner who attested the affiliation. SET NULL so removing an
  -- owner account never cascades away the grant history.
  granted_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- One grant per person per lab (mirrors restaurant_staff_unique_member):
  -- two live grants would make "what may this person do here" ambiguous, and
  -- ambiguity in an authorization check resolves in whichever direction the
  -- query happens to sort.
  CONSTRAINT lab_staff_unique_member UNIQUE (lab_provider_id, user_id)
);

-- The hot paths are "is this user ACTIVE staff of this lab" (actor gate on
-- every staff write) and "who staffs this lab" (owner roster reads).
CREATE INDEX IF NOT EXISTS idx_lab_staff_user ON public.lab_staff (user_id, status);
CREATE INDEX IF NOT EXISTS idx_lab_staff_lab  ON public.lab_staff (lab_provider_id, status);

-- ============================================================================
-- ROW LEVEL SECURITY — mirrors the lab vertical's pattern: the staff member
-- reads their own grant, the owning lab reads its roster, admin reads all;
-- writes go through service_role only (the Go service owns the write path and
-- gates it on VerifiedLabOwner).
-- ============================================================================
ALTER TABLE public.lab_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lab_staff_read ON public.lab_staff;
CREATE POLICY lab_staff_read ON public.lab_staff
  FOR SELECT TO authenticated USING (
    public.is_admin() OR user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.health_providers p
      WHERE p.id = lab_staff.lab_provider_id AND p.owner_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS lab_staff_service ON public.lab_staff;
CREATE POLICY lab_staff_service ON public.lab_staff
  TO service_role USING (TRUE) WITH CHECK (TRUE);

COMMENT ON TABLE public.lab_staff IS
  'Per-lab staff grants (HL-2 affiliation, ADR-PR640): which users may act as this lab''s scientists (bench + HL-7 sign-off) and phlebotomists (collection + custody). Granted by the verified lab owner; the lab service reads ACTIVE rows only.';

COMMIT;
