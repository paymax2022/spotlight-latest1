-- Demo eligibility seed: make 'demo-user' a fully-cleared trader so the Postgres
-- demo path matches the in-memory mock (which seeds an eligible demo user).
-- Local/demo only — in production these facts come from the KYC, suitability and
-- agreement services, not a migration.

BEGIN;

-- Define the active required-agreement set.
INSERT INTO required_agreements (code, version, label, active) VALUES
    ('general_terms',       'v1', 'Paymax General Terms',        TRUE),
    ('crypto_partner_terms','v1', 'Crypto Partner Terms',        TRUE),
    ('risk_disclosure',     'v1', 'Crypto Risk Disclosure',      TRUE)
ON CONFLICT (code, version) DO NOTHING;

-- Demo user accepted every active agreement.
INSERT INTO agreement_acceptances (user_id, code, version) VALUES
    ('demo-user', 'general_terms',        'v1'),
    ('demo-user', 'crypto_partner_terms', 'v1'),
    ('demo-user', 'risk_disclosure',      'v1')
ON CONFLICT (user_id, code, version) DO NOTHING;

-- Demo suitability profile: crypto-eligible, far-future expiry.
INSERT INTO suitability_profiles (id, user_id, risk_category, eligible_products, expires_at) VALUES
    ('suit_demo', 'demo-user', 'growth', '["stock","crypto"]'::jsonb, now() + interval '365 days')
ON CONFLICT (id) DO NOTHING;

COMMIT;
