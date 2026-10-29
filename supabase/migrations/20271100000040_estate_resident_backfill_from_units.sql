-- Every person assigned to a unit is an estate resident. Visitor passes, the resident
-- restriction check and the estate BFF all resolve residency from estate_residents, but a
-- unit can record a person without a membership row: the legacy landlord_id / tenant_id
-- columns, and occupancy rows written before estate_occupancy_admit() created memberships.
-- This backfills the missing membership rows. Additive only, promotion-only:
--   * a person with no membership gets one (role 'resident', the unit as the label);
--   * an existing membership is left untouched, so a banned or soft-deleted membership
--     is NOT revived, and an estate_admin keeps the admin role.
-- Each part runs only where its table and columns exist, so the same script works on a
-- database that has not yet had the occupancy migration.

DO $$
DECLARE
  has_party_cols boolean;
BEGIN
  IF to_regclass('public.estate_residents') IS NULL OR to_regclass('public.estate_properties') IS NULL THEN
    RAISE NOTICE 'estate tables not present; nothing to backfill';
    RETURN;
  END IF;

  -- Live occupancy registrations (estate_unit_occupants).
  IF to_regclass('public.estate_unit_occupants') IS NOT NULL THEN
    EXECUTE $q$
      INSERT INTO estate_residents (estate_id, user_id, unit, role)
      SELECT o.estate_id,
             o.user_id,
             btrim(COALESCE(p.block, '') || ' ' || COALESCE(p.floor, '') || ' ' || p.unit_label),
             'resident'
      FROM estate_unit_occupants o
      JOIN estate_properties p ON p.id = o.property_id
      WHERE o.ended_at IS NULL
      ON CONFLICT (estate_id, user_id) DO NOTHING
    $q$;
  END IF;

  -- Legacy tenant and landlord columns on the unit.
  SELECT COUNT(*) = 6 INTO has_party_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'estate_properties'
    AND column_name IN ('tenant_id', 'landlord_id', 'archived', 'block', 'floor', 'unit_label');

  IF has_party_cols THEN
    EXECUTE $q$
      INSERT INTO estate_residents (estate_id, user_id, unit, role)
      SELECT src.estate_id, src.user_id, src.unit, 'resident'
      FROM (
        SELECT p.estate_id,
               p.tenant_id AS user_id,
               btrim(COALESCE(p.block, '') || ' ' || COALESCE(p.floor, '') || ' ' || p.unit_label) AS unit
        FROM estate_properties p
        WHERE p.tenant_id IS NOT NULL AND NOT p.archived
        UNION
        SELECT p.estate_id,
               p.landlord_id,
               btrim(COALESCE(p.block, '') || ' ' || COALESCE(p.floor, '') || ' ' || p.unit_label)
        FROM estate_properties p
        WHERE p.landlord_id IS NOT NULL AND NOT p.archived
      ) src
      ON CONFLICT (estate_id, user_id) DO NOTHING
    $q$;
  ELSE
    RAISE NOTICE 'estate_properties party columns not present; skipping unit backfill';
  END IF;
END $$;
