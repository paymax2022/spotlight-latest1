-- Crowdfunding — Corporate CSR / matching (Section M).
-- Additive-only — no DROP, no RENAME, no type narrowing. All money is BIGINT kobo.
-- Feature-flagged OFF until corporate partner onboarding (CSR_ENABLED).
--
-- Tables:
--   cf_csr_profiles    — one row per corporate sponsor (budget/committed/matched roll-ups).
--   cf_csr_matches     — a sponsor's match offer against a campaign. Starts
--                        PENDING_APPROVAL and requires an explicit approve → ACTIVE.
--   cf_csr_invoices    — billing records for matched disbursements (seeded samples).
--   cf_employee_giving — employee-giving payroll campaigns (seeded sample).

-- ─── csr profiles ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_csr_profiles (
    user_id              UUID PRIMARY KEY REFERENCES auth.users(id),
    company_name         TEXT NOT NULL DEFAULT '',
    verified             BOOLEAN NOT NULL DEFAULT FALSE,
    annual_budget_kobo   BIGINT  NOT NULL DEFAULT 0 CHECK (annual_budget_kobo >= 0),
    committed_kobo       BIGINT  NOT NULL DEFAULT 0 CHECK (committed_kobo >= 0),
    matched_kobo         BIGINT  NOT NULL DEFAULT 0 CHECK (matched_kobo >= 0),
    campaigns_supported  INTEGER NOT NULL DEFAULT 0,
    employees_giving     INTEGER NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── csr matches ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_csr_matches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sponsor_id      UUID NOT NULL REFERENCES auth.users(id),
    campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    campaign_title  TEXT NOT NULL DEFAULT '',
    ratio           TEXT NOT NULL DEFAULT '1:1' CHECK (ratio IN ('1:1','2:1','0.5:1')),
    cap_kobo        BIGINT  NOT NULL DEFAULT 0 CHECK (cap_kobo >= 0),
    matched_kobo    BIGINT  NOT NULL DEFAULT 0 CHECK (matched_kobo >= 0),
    status          TEXT NOT NULL DEFAULT 'PENDING_APPROVAL'
                        CHECK (status IN ('DRAFT','PENDING_APPROVAL','ACTIVE','COMPLETED','PAUSED')),
    visibility      TEXT NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC','ANONYMOUS')),
    message         TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cf_csr_matches_sponsor_idx  ON cf_csr_matches(sponsor_id);
CREATE INDEX IF NOT EXISTS cf_csr_matches_campaign_idx ON cf_csr_matches(campaign_id);
CREATE INDEX IF NOT EXISTS cf_csr_matches_status_idx   ON cf_csr_matches(status);

-- ─── csr invoices ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_csr_invoices (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sponsor_id  UUID NOT NULL REFERENCES auth.users(id),
    reference   TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    amount_kobo BIGINT  NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
    vat_kobo    BIGINT  NOT NULL DEFAULT 0 CHECK (vat_kobo >= 0),
    total_kobo  BIGINT  NOT NULL DEFAULT 0 CHECK (total_kobo >= 0),
    status      TEXT NOT NULL DEFAULT 'DUE' CHECK (status IN ('PAID','DUE')),
    issued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cf_csr_invoices_sponsor_idx ON cf_csr_invoices(sponsor_id);

-- ─── employee giving ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_employee_giving (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sponsor_id          UUID NOT NULL REFERENCES auth.users(id),
    title               TEXT NOT NULL DEFAULT '',
    goal_kobo           BIGINT  NOT NULL DEFAULT 0 CHECK (goal_kobo >= 0),
    raised_kobo         BIGINT  NOT NULL DEFAULT 0 CHECK (raised_kobo >= 0),
    participants        INTEGER NOT NULL DEFAULT 0,
    ends_at             TIMESTAMPTZ,
    company_match_ratio TEXT NOT NULL DEFAULT '1:1' CHECK (company_match_ratio IN ('1:1','2:1','0.5:1')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cf_employee_giving_sponsor_idx ON cf_employee_giving(sponsor_id);

-- ─── seed data (demo; guarded) ───────────────────────────────────────────────
-- Demo/sample rows keyed to a synthetic sponsor so the CSR dashboards render in
-- a demo/staging environment. sponsor_id is NOT NULL REFERENCES auth.users(id),
-- so on a real/production DB (where the synthetic sponsor does not exist) these
-- seeds would violate the FK. Guarded to run ONLY when the synthetic sponsor
-- exists → a safe no-op in production (no fake data, migration still succeeds).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000000') THEN
    INSERT INTO cf_csr_invoices (sponsor_id, reference, description, amount_kobo, vat_kobo, total_kobo, status, issued_at) VALUES
        ('00000000-0000-0000-0000-000000000000', 'CSR-INV-2026-0001', 'Q1 matched contributions — medical campaigns', 5000000, 375000, 5375000, 'PAID', NOW() - INTERVAL '60 days'),
        ('00000000-0000-0000-0000-000000000000', 'CSR-INV-2026-0002', 'Q2 matched contributions — education campaigns', 3200000, 240000, 3440000, 'DUE',  NOW() - INTERVAL '5 days')
    ON CONFLICT DO NOTHING;

    INSERT INTO cf_employee_giving (sponsor_id, title, goal_kobo, raised_kobo, participants, ends_at, company_match_ratio) VALUES
        ('00000000-0000-0000-0000-000000000000', 'Staff Giving Drive 2026', 10000000, 4200000, 138, NOW() + INTERVAL '45 days', '1:1')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ─── RLS — owner-scoped reads/writes + service_role bypass ────────────────────
ALTER TABLE cf_csr_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_csr_matches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_csr_invoices    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_employee_giving ENABLE ROW LEVEL SECURITY;

-- profiles: a sponsor sees/writes only their own row.
DROP POLICY IF EXISTS "cf_csr_profiles_owner"   ON cf_csr_profiles;
CREATE POLICY "cf_csr_profiles_owner"   ON cf_csr_profiles
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "cf_csr_profiles_service" ON cf_csr_profiles;
CREATE POLICY "cf_csr_profiles_service" ON cf_csr_profiles
    TO service_role USING (TRUE) WITH CHECK (TRUE);

-- matches: scoped to the sponsor that owns them.
DROP POLICY IF EXISTS "cf_csr_matches_owner"   ON cf_csr_matches;
CREATE POLICY "cf_csr_matches_owner"   ON cf_csr_matches
    FOR ALL TO authenticated USING (sponsor_id = auth.uid()) WITH CHECK (sponsor_id = auth.uid());
DROP POLICY IF EXISTS "cf_csr_matches_service" ON cf_csr_matches;
CREATE POLICY "cf_csr_matches_service" ON cf_csr_matches
    TO service_role USING (TRUE) WITH CHECK (TRUE);

-- invoices: read-only to the owning sponsor (issued by the platform/service).
DROP POLICY IF EXISTS "cf_csr_invoices_owner"   ON cf_csr_invoices;
CREATE POLICY "cf_csr_invoices_owner"   ON cf_csr_invoices
    FOR SELECT TO authenticated USING (sponsor_id = auth.uid());
DROP POLICY IF EXISTS "cf_csr_invoices_service" ON cf_csr_invoices;
CREATE POLICY "cf_csr_invoices_service" ON cf_csr_invoices
    TO service_role USING (TRUE) WITH CHECK (TRUE);

-- employee giving: scoped to the owning sponsor.
DROP POLICY IF EXISTS "cf_employee_giving_owner"   ON cf_employee_giving;
CREATE POLICY "cf_employee_giving_owner"   ON cf_employee_giving
    FOR ALL TO authenticated USING (sponsor_id = auth.uid()) WITH CHECK (sponsor_id = auth.uid());
DROP POLICY IF EXISTS "cf_employee_giving_service" ON cf_employee_giving;
CREATE POLICY "cf_employee_giving_service" ON cf_employee_giving
    TO service_role USING (TRUE) WITH CHECK (TRUE);
