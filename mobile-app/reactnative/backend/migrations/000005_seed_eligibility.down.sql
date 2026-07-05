-- Reverse of 000005_seed_eligibility.up.sql (demo data only).
BEGIN;

DELETE FROM suitability_profiles  WHERE id = 'suit_demo';
DELETE FROM agreement_acceptances WHERE user_id = 'demo-user';
DELETE FROM required_agreements
    WHERE code IN ('general_terms', 'crypto_partner_terms', 'risk_disclosure')
      AND version = 'v1';

COMMIT;
