-- Crowdfunding — ADMIN domain (finance/refunds/settlement, disputes, fraud,
-- KYC/KYB, compliance, users). Additive-only.
-- IRON RULES: no DROP, no RENAME, no type narrowing. All money is BIGINT kobo.
-- These are admin-operational tables: service_role bypass ONLY (no authenticated
-- SELECT policy → not visible to members). Admin decisions are guarded transitions
-- that require a note on reject/freeze and write an audit row.

-- ─── refunds / chargebacks ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_refunds (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference        TEXT NOT NULL,
    campaign_title   TEXT NOT NULL,
    contributor_name TEXT NOT NULL,
    amount_kobo      BIGINT NOT NULL CHECK (amount_kobo >= 0),
    reason           TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL DEFAULT 'REQUESTED'
                         CHECK (status IN ('REQUESTED','APPROVED','REJECTED','PROCESSED')),
    requested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    refund_eligible  BOOLEAN NOT NULL DEFAULT TRUE,
    admin_note       TEXT,
    decided_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS cf_refunds_status_idx ON cf_refunds(status);

INSERT INTO cf_refunds (reference, campaign_title, contributor_name, amount_kobo, reason, status, requested_at, refund_eligible) VALUES
    ('SPL-RF-7001', 'Flood Relief for Bayelsa Families', 'Anonymous',      2000000, 'Concerns about how funds are used',     'REQUESTED', NOW() - INTERVAL '6 hours',  TRUE),
    ('SPL-RF-7002', 'Adire Documentary',                 'Tunde Bakare',    500000, 'Contributed by mistake',                'REQUESTED', NOW() - INTERVAL '14 hours', TRUE),
    ('SPL-RF-6990', 'Cryptocurrency Doubling Scheme',    'Bola Ighodalo',  5000000, 'Campaign turned out to be misleading',  'APPROVED',  NOW() - INTERVAL '2 days',    TRUE)
ON CONFLICT DO NOTHING;

-- ─── settlement batches ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_settlements (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference    TEXT NOT NULL,
    payout_count INTEGER NOT NULL DEFAULT 0,
    gross_kobo   BIGINT NOT NULL DEFAULT 0,
    fee_kobo     BIGINT NOT NULL DEFAULT 0,
    net_kobo     BIGINT NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING','PROCESSING','SETTLED','FAILED')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO cf_settlements (reference, payout_count, gross_kobo, fee_kobo, net_kobo, status, created_at) VALUES
    ('SPL-STL-2026-06-19', 18, 240000000,  6000000,  234000000, 'PROCESSING', NOW() - INTERVAL '1 day'),
    ('SPL-STL-2026-06-18', 31, 412000000, 10300000,  401700000, 'SETTLED',     NOW() - INTERVAL '2 days'),
    ('SPL-STL-2026-06-17', 12,  88000000,  2200000,   85800000, 'SETTLED',     NOW() - INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- ─── disputes ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_disputes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference      TEXT NOT NULL,
    type           TEXT NOT NULL DEFAULT 'OTHER'
                       CHECK (type IN ('FAKE_CAMPAIGN','REFUND','REWARD','PAYMENT','WITHDRAWAL','OTHER')),
    status         TEXT NOT NULL DEFAULT 'OPEN'
                       CHECK (status IN ('OPEN','INVESTIGATING','ESCALATED','RESOLVED','CLOSED')),
    campaign_id    UUID,
    campaign_title TEXT NOT NULL DEFAULT '',
    raised_by      TEXT NOT NULL DEFAULT '',
    description    TEXT NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sla_hours_left INTEGER NOT NULL DEFAULT 24,
    resolution     TEXT
                       CHECK (resolution IS NULL OR resolution IN ('NO_ACTION','REFUND','PARTIAL_REFUND','FREEZE','WARN_CREATOR')),
    admin_note     TEXT
);
CREATE INDEX IF NOT EXISTS cf_disputes_status_idx ON cf_disputes(status);

INSERT INTO cf_disputes (reference, type, status, campaign_id, campaign_title, raised_by, description, created_at, sla_hours_left, resolution, admin_note) VALUES
    ('SPL-DS-9001', 'FAKE_CAMPAIGN', 'OPEN',          NULL, 'Cryptocurrency Doubling Scheme',     'Community report', 'Multiple users report this as a guaranteed-returns scam.', NOW() - INTERVAL '10 hours', 4,  NULL,     NULL),
    ('SPL-DS-9002', 'REWARD',        'INVESTIGATING', NULL, 'Adire Documentary',                  'Fatima Sani',      'Producer-credit reward not delivered 3 weeks after the estimated date.', NOW() - INTERVAL '1 day', 20, NULL, 'Contacted creator for shipping update.'),
    ('SPL-DS-8990', 'REFUND',        'RESOLVED',      NULL, 'Flood Relief for Bayelsa Families',  'Anonymous',        'Requested refund denied by creator.', NOW() - INTERVAL '4 days', 0, 'REFUND', 'Refund issued per campaign policy.')
ON CONFLICT DO NOTHING;

-- ─── fraud alerts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_fraud_alerts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id    UUID,
    campaign_title TEXT NOT NULL DEFAULT '',
    creator_name   TEXT NOT NULL DEFAULT '',
    risk_level     TEXT NOT NULL DEFAULT 'LOW' CHECK (risk_level IN ('LOW','MEDIUM','HIGH')),
    status         TEXT NOT NULL DEFAULT 'OPEN'
                       CHECK (status IN ('OPEN','INVESTIGATING','RESOLVED','FROZEN')),
    signals        TEXT[] NOT NULL DEFAULT '{}',
    raised_kobo    BIGINT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    admin_note     TEXT
);
CREATE INDEX IF NOT EXISTS cf_fraud_alerts_status_idx ON cf_fraud_alerts(status);

INSERT INTO cf_fraud_alerts (campaign_title, creator_name, risk_level, status, signals, raised_kobo, created_at) VALUES
    ('Cryptocurrency Doubling Scheme',    'John Doe',              'HIGH',   'OPEN',          ARRAY['Guaranteed-returns language','Bank account on 3 other campaigns','Unverified creator'], 0,        NOW() - INTERVAL '10 hours'),
    ('Emergency Medical Fund',            'Unverified User',       'HIGH',   'FROZEN',        ARRAY['Rapid withdrawal after funding','Mismatched KYC/bank name'],                              54000000, NOW() - INTERVAL '9 hours'),
    ('Flood Relief for Bayelsa Families', 'Niger Delta Relief Org','MEDIUM', 'INVESTIGATING', ARRAY['Document pending verification'],                                                          0,        NOW() - INTERVAL '8 hours')
ON CONFLICT DO NOTHING;

-- ─── KYC / KYB cases ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_kyc_cases (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind              TEXT NOT NULL DEFAULT 'KYC' CHECK (kind IN ('KYC','KYB')),
    status            TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
    applicant_name    TEXT NOT NULL,
    applicant_type    TEXT NOT NULL DEFAULT 'Individual',
    email             TEXT NOT NULL DEFAULT '',
    id_label          TEXT NOT NULL DEFAULT '',
    bank_label        TEXT NOT NULL DEFAULT '',
    submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duplicate_identity BOOLEAN NOT NULL DEFAULT FALSE,
    duplicate_bank    BOOLEAN NOT NULL DEFAULT FALSE,
    risk_level        TEXT NOT NULL DEFAULT 'LOW' CHECK (risk_level IN ('LOW','MEDIUM','HIGH')),
    admin_note        TEXT,
    decided_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS cf_kyc_cases_status_idx ON cf_kyc_cases(status);
CREATE INDEX IF NOT EXISTS cf_kyc_cases_kind_idx   ON cf_kyc_cases(kind);

CREATE TABLE IF NOT EXISTS cf_kyc_docs (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id  UUID NOT NULL REFERENCES cf_kyc_cases(id) ON DELETE CASCADE,
    label    TEXT NOT NULL,
    type     TEXT NOT NULL DEFAULT 'image' CHECK (type IN ('image','pdf')),
    verified BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS cf_kyc_docs_case_idx ON cf_kyc_docs(case_id);

-- Seed a couple of cases + their docs (deterministic ids so docs can reference them).
INSERT INTO cf_kyc_cases (id, kind, status, applicant_name, applicant_type, email, id_label, bank_label, submitted_at, duplicate_identity, duplicate_bank, risk_level) VALUES
    ('11111111-1111-1111-1111-111111111111', 'KYC', 'PENDING', 'Aisha Bello',            'Individual', 'aisha.bello@example.com', 'NIN ... 4821', 'GTBank ... 4821', NOW() - INTERVAL '1 day',  FALSE, FALSE, 'LOW'),
    ('22222222-2222-2222-2222-222222222222', 'KYC', 'PENDING', 'John Doe',               'Individual', 'jd1990@example.com',      'NIN ... 0012', 'Access ... 0012', NOW() - INTERVAL '8 hours', TRUE,  TRUE,  'HIGH'),
    ('33333333-3333-3333-3333-333333333333', 'KYB', 'PENDING', 'Enugu Codes Initiative', 'NGO',        'hello@enugucodes.org',    'RC 1456782',   'Zenith ... 7740', NOW() - INTERVAL '2 days',  FALSE, FALSE, 'LOW')
ON CONFLICT (id) DO NOTHING;

INSERT INTO cf_kyc_docs (case_id, label, type, verified) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Government ID (NIN)',          'image', TRUE),
    ('11111111-1111-1111-1111-111111111111', 'Selfie verification',          'image', TRUE),
    ('22222222-2222-2222-2222-222222222222', 'Government ID (NIN)',          'image', FALSE),
    ('33333333-3333-3333-3333-333333333333', 'CAC registration',             'pdf',   TRUE),
    ('33333333-3333-3333-3333-333333333333', 'Board authorisation letter',   'pdf',   TRUE)
ON CONFLICT DO NOTHING;

-- ─── data subject requests (GDPR/NDPR export/deletion) ───────────────────────
CREATE TABLE IF NOT EXISTS cf_data_requests (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type         TEXT NOT NULL DEFAULT 'EXPORT' CHECK (type IN ('EXPORT','DELETION')),
    user_name    TEXT NOT NULL DEFAULT '',
    email        TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    due_by       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);
CREATE INDEX IF NOT EXISTS cf_data_requests_status_idx ON cf_data_requests(status);

INSERT INTO cf_data_requests (type, user_name, email, status, requested_at, due_by) VALUES
    ('EXPORT',   'Chidi Okafor',   'chidi@example.com', 'PENDING',     NOW() - INTERVAL '4 hours', NOW() + INTERVAL '2 days'),
    ('DELETION', 'Bola Ighodalo',  'bola@example.com',  'IN_PROGRESS', NOW() - INTERVAL '2 days',  NOW() + INTERVAL '28 days'),
    ('EXPORT',   'Ngozi Adeyemi',  'ngozi@example.com', 'COMPLETED',   NOW() - INTERVAL '12 days', NOW() - INTERVAL '10 days')
ON CONFLICT DO NOTHING;

-- ─── audit logs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_audit_logs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor      TEXT NOT NULL DEFAULT '',
    action     TEXT NOT NULL DEFAULT '',
    target     TEXT NOT NULL DEFAULT '',
    ip         TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cf_audit_logs_created_idx ON cf_audit_logs(created_at DESC);

INSERT INTO cf_audit_logs (actor, action, target, ip, created_at) VALUES
    ('admin@spotlight.ng',      'campaign.approve',   'rv1 - Help Baby Zara',              '102.89.x.x',  NOW() - INTERVAL '2 hours'),
    ('risk@spotlight.ng',       'campaign.freeze',    'my7 - Emergency Medical Fund',      '102.89.x.x',  NOW() - INTERVAL '4 hours'),
    ('finance@spotlight.ng',    'withdrawal.approve', 'SPL-WD-3001',                       '197.210.x.x', NOW() - INTERVAL '5 hours'),
    ('admin@spotlight.ng',      'campaign.reject',    'rv2 - Crypto Doubling Scheme',      '102.89.x.x',  NOW() - INTERVAL '1 day'),
    ('compliance@spotlight.ng', 'config.fees.update', 'platformFeeBps 250->250',           '105.112.x.x', NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- ─── admin user/creator registry ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_admin_users (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                   TEXT NOT NULL,
    email                  TEXT NOT NULL DEFAULT '',
    role                   TEXT NOT NULL DEFAULT 'CONTRIBUTOR'
                               CHECK (role IN ('CONTRIBUTOR','CREATOR','ORGANISATION')),
    type                   TEXT NOT NULL DEFAULT 'Individual',
    verification           TEXT NOT NULL DEFAULT 'UNVERIFIED'
                               CHECK (verification IN ('UNVERIFIED','EMAIL','KYC','KYB','FULL')),
    status                 TEXT NOT NULL DEFAULT 'ACTIVE'
                               CHECK (status IN ('ACTIVE','SUSPENDED','RESTRICTED')),
    risk_level             TEXT NOT NULL DEFAULT 'LOW' CHECK (risk_level IN ('LOW','MEDIUM','HIGH')),
    campaigns_created      INTEGER NOT NULL DEFAULT 0,
    total_raised_kobo      BIGINT NOT NULL DEFAULT 0,
    total_contributed_kobo BIGINT NOT NULL DEFAULT 0,
    joined_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cf_admin_users_role_idx   ON cf_admin_users(role);
CREATE INDEX IF NOT EXISTS cf_admin_users_status_idx ON cf_admin_users(status);

CREATE TABLE IF NOT EXISTS cf_user_activity (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES cf_admin_users(id) ON DELETE CASCADE,
    action     TEXT NOT NULL DEFAULT '',
    detail     TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cf_user_activity_user_idx ON cf_user_activity(user_id, created_at DESC);

INSERT INTO cf_admin_users (id, name, email, role, type, verification, status, risk_level, campaigns_created, total_raised_kobo, total_contributed_kobo, joined_at, last_active_at) VALUES
    ('a1111111-1111-1111-1111-111111111111', 'Aisha Bello',            'aisha.bello@example.com', 'CREATOR',      'Individual', 'FULL',  'ACTIVE',    'LOW',  1, 1213400000, 50000000, NOW() - INTERVAL '500 days', NOW() - INTERVAL '2 hours'),
    ('a2222222-2222-2222-2222-222222222222', 'Adaeze Okonkwo',         'adaeze@example.com',      'CREATOR',      'Individual', 'KYC',   'ACTIVE',    'LOW',  5,  487500000, 12000000, NOW() - INTERVAL '450 days', NOW() - INTERVAL '1 hour'),
    ('a3333333-3333-3333-3333-333333333333', 'John Doe',               'jd1990@example.com',      'CREATOR',      'Individual', 'EMAIL', 'SUSPENDED', 'HIGH', 4,          0,        0, NOW() - INTERVAL '23 days',  NOW() - INTERVAL '1 day'),
    ('a4444444-4444-4444-4444-444444444444', 'Niger Delta Relief Org', 'ops@ndrelief.org',        'ORGANISATION', 'NGO',        'KYB',   'ACTIVE',    'LOW',  8, 2140000000,        0, NOW() - INTERVAL '600 days', NOW() - INTERVAL '3 hours'),
    ('a5555555-5555-5555-5555-555555555555', 'Chidi Okafor',           'chidi@example.com',       'CONTRIBUTOR',  'Individual', 'KYC',   'ACTIVE',    'LOW',  0,          0,  8400000, NOW() - INTERVAL '280 days', NOW() - INTERVAL '2 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO cf_user_activity (user_id, action, detail, created_at) VALUES
    ('a1111111-1111-1111-1111-111111111111', 'campaign.create',      'Help Baby Zara Get Open-Heart Surgery',        NOW() - INTERVAL '35 days'),
    ('a1111111-1111-1111-1111-111111111111', 'withdrawal.request',   'SPL-WD-3001 - N400,000',                       NOW() - INTERVAL '14 days'),
    ('a2222222-2222-2222-2222-222222222222', 'campaign.create',      'New Borehole for Amaeze Community',            NOW() - INTERVAL '70 days'),
    ('a3333333-3333-3333-3333-333333333333', 'campaign.reject',      'Cryptocurrency Doubling Scheme - violation',   NOW() - INTERVAL '1 day'),
    ('a3333333-3333-3333-3333-333333333333', 'account.suspend',      'Multiple high-risk campaigns',                 NOW() - INTERVAL '1 day'),
    ('a4444444-4444-4444-4444-444444444444', 'campaign.create',      'Flood Relief for Bayelsa Families',            NOW() - INTERVAL '6 days'),
    ('a5555555-5555-5555-5555-555555555555', 'contribution.create',  'N5,000 to Help Baby Zara',                     NOW() - INTERVAL '2 hours')
ON CONFLICT DO NOTHING;

-- ─── cf_withdrawals safety net ───────────────────────────────────────────────
-- The wallet domain owns this table (20260622010000_crowdfunding_wallet.sql).
-- Re-declare it IF NOT EXISTS with the SAME columns so admin can read/approve
-- withdrawals regardless of migration apply order. No-op if it already exists.
CREATE TABLE IF NOT EXISTS cf_withdrawals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     UUID,
    creator_id      UUID,
    reference       TEXT NOT NULL,
    amount_kobo     BIGINT NOT NULL CHECK (amount_kobo >= 100),
    bank_label      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','PROCESSING','APPROVED','COMPLETED','REJECTED')),
    reason          TEXT,
    idempotency_key TEXT NOT NULL,
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cf_withdrawals_status_idx ON cf_withdrawals(status);

-- ─── RLS — service_role bypass ONLY (admin tables, not member-readable) ──────
ALTER TABLE cf_refunds       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_settlements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_disputes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_fraud_alerts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_kyc_cases     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_kyc_docs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_data_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_audit_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_admin_users   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_user_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_withdrawals   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cf_refunds_service"       ON cf_refunds;
CREATE POLICY "cf_refunds_service"       ON cf_refunds       TO service_role USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "cf_settlements_service"   ON cf_settlements;
CREATE POLICY "cf_settlements_service"   ON cf_settlements   TO service_role USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "cf_disputes_service"      ON cf_disputes;
CREATE POLICY "cf_disputes_service"      ON cf_disputes      TO service_role USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "cf_fraud_alerts_service"  ON cf_fraud_alerts;
CREATE POLICY "cf_fraud_alerts_service"  ON cf_fraud_alerts  TO service_role USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "cf_kyc_cases_service"     ON cf_kyc_cases;
CREATE POLICY "cf_kyc_cases_service"     ON cf_kyc_cases     TO service_role USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "cf_kyc_docs_service"      ON cf_kyc_docs;
CREATE POLICY "cf_kyc_docs_service"      ON cf_kyc_docs      TO service_role USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "cf_data_requests_service" ON cf_data_requests;
CREATE POLICY "cf_data_requests_service" ON cf_data_requests TO service_role USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "cf_audit_logs_service"    ON cf_audit_logs;
CREATE POLICY "cf_audit_logs_service"    ON cf_audit_logs    TO service_role USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "cf_admin_users_service"   ON cf_admin_users;
CREATE POLICY "cf_admin_users_service"   ON cf_admin_users   TO service_role USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "cf_user_activity_service" ON cf_user_activity;
CREATE POLICY "cf_user_activity_service" ON cf_user_activity TO service_role USING (TRUE) WITH CHECK (TRUE);
-- Note: cf_withdrawals already has its own select-own + service policies from the
-- wallet migration; we do NOT redefine them here (additive, no policy narrowing).
