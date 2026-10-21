-- Bus Transport PRD §5 — operator onboarding verification gate (KYB).
-- A bus_providers row may self-register today, but PRD §5 requires a verified
-- application (CAC registry match + owner Tier-2 KYC + platform maker-checker
-- review) before the operator can publish into the public interstate catalog
-- (buskyb.CanPublish) — which is also what bus_providers.verification_status
-- = 'verified' gates in SearchBusTrips.
--
-- ADDITIVE-ONLY: no DROP/RENAME/type narrowing. Three new tables + a guarded
-- transition helper + a BEFORE UPDATE trigger. bus_providers is not altered.
--
-- NOTE: version 20271052000000 was already claimed by
-- transport_pin_attempts.sql upstream; this file renumbered to 20271053000000
-- per the never-reuse-a-migration-version rule.

-- ─── bus_operator_application: one KYB application per provider ──────────────
CREATE TABLE IF NOT EXISTS bus_operator_application (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id        UUID NOT NULL UNIQUE REFERENCES bus_providers(id),
    submitted_by       UUID NOT NULL REFERENCES auth.users(id),
    legal_name         TEXT,
    rc_number          TEXT,               -- CAC RC/BN number (drives the cac check)
    state              TEXT NOT NULL DEFAULT 'draft'
        CHECK (state IN ('draft','submitted','cac_verification_pending',
                         'kyc_verification_pending','needs_information',
                         'under_review','approved','rejected','suspended','expired')),
    terms_accepted_at  TIMESTAMPTZ,
    terms_version      TEXT,
    submitted_at       TIMESTAMPTZ,
    decided_at         TIMESTAMPTZ,
    decided_by         UUID REFERENCES auth.users(id),
    decision_reason    TEXT,
    version            INTEGER NOT NULL DEFAULT 1,  -- bumped by the transition trigger
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Maker-checker (DB backstop; enforced in Go too): the reviewer who records
    -- a decision can never be the submitter.
    CHECK (decided_by IS NULL OR decided_by <> submitted_by)
);
CREATE INDEX IF NOT EXISTS bus_operator_application_state_idx
    ON bus_operator_application (state, submitted_at);

-- ─── bus_operator_verification: one row per verification check attempt ───────
-- payload_snapshot is MINIMIZED: whitelist of non-PII fields only
-- (found / name / status / rc_number / kyc_tier). Raw provider payloads and PII
-- never land here — mirror of the kycverify PII rule.
CREATE TABLE IF NOT EXISTS bus_operator_verification (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id   UUID NOT NULL REFERENCES bus_operator_application(id),
    check_type       TEXT NOT NULL CHECK (check_type IN ('cac','kyc','payout','document')),
    provider         TEXT,               -- e.g. 'cac-vas', 'cac-sandbox', 'kycverify'
    provider_ref     TEXT,
    status           TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','passed','failed','error')),
    result_code      TEXT,               -- match | provider_unavailable | company_not_found |
                                         -- mismatch | invalid_registration | policy_rejected |
                                         -- kyc_tier_<n>
    payload_snapshot JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bus_operator_verification_app_idx
    ON bus_operator_verification (application_id, check_type, created_at);

-- ─── bus_operator_transition: immutable state-change history ─────────────────
CREATE TABLE IF NOT EXISTS bus_operator_transition (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id  UUID NOT NULL REFERENCES bus_operator_application(id),
    from_state      TEXT,                -- NULL on application creation
    to_state        TEXT NOT NULL,
    actor           TEXT,                -- user id, or 'system' for automated checks
    reason          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bus_operator_transition_app_idx
    ON bus_operator_transition (application_id, created_at);

-- ─── Allowed transitions (must mirror fsm.Table in buskyb/service.go) ────────
CREATE OR REPLACE FUNCTION bus_operator_kyb_can_transition(p_from TEXT, p_to TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_from
        WHEN 'draft'                    THEN p_to IN ('submitted')
        WHEN 'submitted'                THEN p_to IN ('cac_verification_pending','needs_information')
        WHEN 'cac_verification_pending' THEN p_to IN ('kyc_verification_pending','under_review','needs_information')
        WHEN 'kyc_verification_pending' THEN p_to IN ('under_review','needs_information')
        WHEN 'needs_information'        THEN p_to IN ('submitted')
        WHEN 'under_review'             THEN p_to IN ('approved','rejected','needs_information')
        WHEN 'approved'                 THEN p_to IN ('suspended','expired')
        WHEN 'rejected'                 THEN p_to IN ('submitted')
        WHEN 'suspended'                THEN p_to IN ('approved','expired')
        WHEN 'expired'                  THEN p_to IN ('submitted')
        ELSE FALSE
    END;
$$;

-- Guard: every state change must be a legal move; version auto-increments so
-- optimistic-concurrency writers can detect a stale read.
CREATE OR REPLACE FUNCTION bus_operator_kyb_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.state IS DISTINCT FROM OLD.state THEN
        IF NOT bus_operator_kyb_can_transition(OLD.state, NEW.state) THEN
            RAISE EXCEPTION 'bus_operator_application: illegal state transition % -> %',
                OLD.state, NEW.state USING ERRCODE = 'check_violation';
        END IF;
        NEW.version := OLD.version + 1;
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bus_operator_application_guard ON bus_operator_application; -- idempotent create
CREATE TRIGGER bus_operator_application_guard
    BEFORE UPDATE ON bus_operator_application
    FOR EACH ROW EXECUTE FUNCTION bus_operator_kyb_guard();

-- ─── RLS (mirrors bus_providers) ─────────────────────────────────────────────
ALTER TABLE bus_operator_application  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bus_operator_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE bus_operator_transition   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bus_operator_application_owner_read" ON bus_operator_application
    FOR SELECT TO authenticated USING (submitted_by = auth.uid());
CREATE POLICY "bus_operator_application_service" ON bus_operator_application
    TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "bus_operator_verification_service" ON bus_operator_verification
    TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "bus_operator_transition_service" ON bus_operator_transition
    TO service_role USING (TRUE) WITH CHECK (TRUE);
