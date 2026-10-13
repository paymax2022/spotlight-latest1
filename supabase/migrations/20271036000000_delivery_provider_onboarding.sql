-- Delivery provider onboarding (Slice A): record a provider's services of
-- interest and coverage areas, and support delivery vehicle types.
--
-- Additive-only (CLAUDE.md): new columns with defaults, a new CHECK on a new
-- column, and DROP NOT NULL on vehicles.plate_number (a widening the additive
-- guard allows) so a bicycle courier can be recorded without a plate. No
-- existing row is invalidated: arrays default to '{}' and existing vehicles
-- take vehicle_type 'car'. Idempotent / safe to re-run.
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS service_interests text[] NOT NULL DEFAULT '{}';
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS coverage_areas text[] NOT NULL DEFAULT '{}';

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS vehicle_type text NOT NULL DEFAULT 'car';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_vehicle_type_check'
  ) THEN
    ALTER TABLE vehicles
      ADD CONSTRAINT vehicles_vehicle_type_check
      CHECK (vehicle_type IN ('car','motorcycle','bicycle'));
  END IF;
END $$;

ALTER TABLE vehicles
  ALTER COLUMN plate_number DROP NOT NULL;
