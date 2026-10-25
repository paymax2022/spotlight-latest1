-- Estate UAT (EST-UAT-0038, lane estate-a): durable guard behind
-- Service.AddProperty's in-code duplicate check. Closes the TOCTOU race between
-- two admins adding the same unit concurrently. Additive-only.
--
-- Guarded: if live data already holds duplicate active units, the index is
-- skipped with a WARNING instead of aborting the migration chain. Find them with:
--   SELECT estate_id, unit_label, COALESCE(block,''), COUNT(*)
--   FROM estate_properties WHERE archived = FALSE GROUP BY 1,2,3 HAVING COUNT(*) > 1;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM estate_properties WHERE archived = FALSE
    GROUP BY estate_id, unit_label, COALESCE(block, '') HAVING COUNT(*) > 1
  ) THEN
    RAISE WARNING 'uidx_estate_properties_unit_key skipped: duplicate active units exist — dedupe, then re-run this statement';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uidx_estate_properties_unit_key
      ON estate_properties (estate_id, unit_label, COALESCE(block, ''))
      WHERE archived = FALSE;
  END IF;
END $$;
