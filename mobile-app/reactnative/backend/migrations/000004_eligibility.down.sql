-- Reverse of 000004_eligibility.up.sql.
BEGIN;

DROP TABLE IF EXISTS agreement_acceptances;
DROP TABLE IF EXISTS required_agreements;
DROP TABLE IF EXISTS suitability_profiles;
ALTER TABLE users DROP COLUMN IF EXISTS status;

COMMIT;
