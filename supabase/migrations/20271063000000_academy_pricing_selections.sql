-- Per-area format choices. The accordion UI lets an applicant pick a DIFFERENT
-- format for each area of interest (Acting → 1 month - Boarding, Script
-- Writing → Weekend), so one pricing_option_key per application no longer
-- describes the tuition. The map is {"<area_slug>": "<pricing_key>"} and the
-- frozen tuition_total_ngn is its sum. pricing_option_key stays populated when
-- every area shares one format, for existing readers.

ALTER TABLE academy_applications ADD COLUMN IF NOT EXISTS pricing_selections jsonb;
