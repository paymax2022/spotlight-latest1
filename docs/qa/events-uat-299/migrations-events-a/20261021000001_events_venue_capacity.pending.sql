-- events-a UAT remediation (EVTA-D008): aggregate venue capacity.
-- No organiser-side cap exists today; SUM(tier.capacity) can exceed any
-- intended venue limit (EVT-UAT-088 fails). Adds a nullable capacity column;
-- enforcement lands in top5events AddTier/UpdateTier once applied.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS capacity int;
ALTER TABLE public.events ADD CONSTRAINT events_capacity_nonnegative
  CHECK (capacity IS NULL OR capacity >= 0);
