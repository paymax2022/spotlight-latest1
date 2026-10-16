-- health.vet availability (slice 2 of the vet profile & availability design).
--
-- A vet's weekly working windows, one per visit type, and time off. Slots are
-- computed server-side from these rows (backend/internal/health/vet/availability.go)
-- and never stored. Additive only: two new tables, RLS, no changes to existing rows.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vet_weekly_hours (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  weekday       smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = Sunday
  start_minute  smallint NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute    smallint NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  visit_type    text     NOT NULL CHECK (visit_type IN ('TELE','HOME','CLINIC')),
  enabled       boolean  NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (end_minute > start_minute)
);
CREATE INDEX IF NOT EXISTS idx_vet_weekly_hours_provider
  ON public.vet_weekly_hours (provider_id, weekday);

CREATE TABLE IF NOT EXISTS public.vet_availability_blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  reason      text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_vet_availability_blocks_provider
  ON public.vet_availability_blocks (provider_id, starts_at);

-- RLS, mirroring vet_services: the Go service (service_role) writes and reads;
-- the owning vet may read its own rows directly; admin sees all.
ALTER TABLE public.vet_weekly_hours          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vet_availability_blocks   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vet_weekly_hours_owner ON public.vet_weekly_hours;
CREATE POLICY vet_weekly_hours_owner ON public.vet_weekly_hours
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.health_providers p
      WHERE p.id = vet_weekly_hours.provider_id AND p.owner_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS vet_weekly_hours_service ON public.vet_weekly_hours;
CREATE POLICY vet_weekly_hours_service ON public.vet_weekly_hours
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS vet_availability_blocks_owner ON public.vet_availability_blocks;
CREATE POLICY vet_availability_blocks_owner ON public.vet_availability_blocks
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.health_providers p
      WHERE p.id = vet_availability_blocks.provider_id AND p.owner_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS vet_availability_blocks_service ON public.vet_availability_blocks;
CREATE POLICY vet_availability_blocks_service ON public.vet_availability_blocks
  TO service_role USING (TRUE) WITH CHECK (TRUE);

COMMIT;
