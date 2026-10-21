-- PENDING (lane estate-a): backs Service.AddProperty's in-code duplicate check
-- (EST-UAT-0038). Additive-only; apply as a normal timestamped migration at
-- consolidation. The code-level check remains as defense in depth and produces
-- the friendly error message; this index closes the TOCTOU race between two
-- admins adding the same unit concurrently.
--
-- NOTE for the applying reviewer: dedupe existing rows first if prod data has
-- duplicates, e.g. archive extras:
--   SELECT estate_id, unit_label, COALESCE(block,''), COUNT(*)
--   FROM estate_properties WHERE archived=FALSE
--   GROUP BY 1,2,3 HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_estate_properties_unit_key
    ON estate_properties (estate_id, unit_label, COALESCE(block, ''))
    WHERE archived = FALSE;
