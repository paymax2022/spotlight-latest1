-- SP-01 / SP-02 (Estate Visitor Access UAT): delegated officer roles + guard-gate
-- enforcement substrate + resident arrival approval.
-- ADDITIVE ONLY — CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, policies guarded
-- by a pg_policies check so a re-apply is a no-op; no DROP,
-- no RENAME, no type narrowing. The existing single estate_residents.role
-- (resident|estate_admin) is left untouched; delegated officer capabilities are a
-- separate, expiring grant plane so nothing that relied on the old two-role model
-- changes behaviour. Closes gap-analysis themes 1 & 2 (docs/uat/estate/gap-analysis.md).

-- ── estate_staff_grants: expiring, revocable delegated officer roles ──────────
-- The workplan (§4.1/§4.2) requires distinct scoped roles (Gate Officer, Gate
-- Supervisor, Finance/Election/Facility Officer, Meeting Secretary, Auditor) that
-- were previously all collapsed onto estate_admin. Grants are time-bounded and
-- individually revocable; the auditor role is read-only by convention enforced
-- server-side in the Go service.
CREATE TABLE IF NOT EXISTS estate_staff_grants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id   UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN
                ('gate_officer','gate_supervisor','finance_officer',
                 'election_officer','facility_officer','meeting_secretary','auditor')),
    granted_by  UUID NOT NULL REFERENCES auth.users(id),
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ,               -- NULL = no expiry
    revoked_at  TIMESTAMPTZ,              -- set = revoked (fail-closed in role lookup)
    UNIQUE (estate_id, user_id, role)
);
CREATE INDEX IF NOT EXISTS idx_staff_grants_estate ON estate_staff_grants (estate_id, user_id);
CREATE INDEX IF NOT EXISTS idx_staff_grants_active ON estate_staff_grants (estate_id, role)
    WHERE revoked_at IS NULL;

ALTER TABLE estate_staff_grants ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'estate_staff_grants' AND policyname = 'staff_grants_select') THEN
        CREATE POLICY "staff_grants_select" ON estate_staff_grants FOR SELECT TO authenticated
            USING (user_id = auth.uid()
                OR EXISTS (SELECT 1 FROM estate_residents er
                    WHERE er.estate_id = estate_staff_grants.estate_id AND er.user_id = auth.uid()
                      AND er.role = 'estate_admin'));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'estate_staff_grants' AND policyname = 'staff_grants_service') THEN
        CREATE POLICY "staff_grants_service" ON estate_staff_grants TO service_role
            USING (TRUE) WITH CHECK (TRUE);
    END IF;
END $$;

-- ── visitor_access_codes: optional host-approval gate ─────────────────────────
-- When true, a guard check-in is refused until the issuing resident approves the
-- arrival (see visitor_arrival_requests). Default false preserves the existing
-- auto-admit behaviour for every current code/journey.
ALTER TABLE visitor_access_codes
    ADD COLUMN IF NOT EXISTS require_host_approval BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE visitor_access_codes
    ADD COLUMN IF NOT EXISTS gate_id UUID REFERENCES estate_gates(id) ON DELETE SET NULL;

-- ── visitor_arrival_requests: resident accept/decline of a guest arrival ──────
-- The workplan (M05 0088–0090) requires a request→accept/decline/timeout loop
-- rather than a fire-and-forget notification. The guard admit path consults the
-- latest live decision for a code before allowing entry.
CREATE TABLE IF NOT EXISTS visitor_arrival_requests (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id      UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    access_code_id UUID NOT NULL REFERENCES visitor_access_codes(id) ON DELETE CASCADE,
    host_id        UUID NOT NULL REFERENCES auth.users(id),   -- the issuing resident
    gate_id        UUID REFERENCES estate_gates(id) ON DELETE SET NULL,
    status         TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','declined','timeout')),
    requested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_by     UUID REFERENCES auth.users(id),
    decided_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_arrival_code  ON visitor_arrival_requests (access_code_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_arrival_host  ON visitor_arrival_requests (host_id, status);
CREATE INDEX IF NOT EXISTS idx_arrival_open  ON visitor_arrival_requests (estate_id, status)
    WHERE status = 'pending';

ALTER TABLE visitor_arrival_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'visitor_arrival_requests' AND policyname = 'arrival_select') THEN
        CREATE POLICY "arrival_select" ON visitor_arrival_requests FOR SELECT TO authenticated
            USING (
                host_id = auth.uid()
                OR EXISTS (SELECT 1 FROM estate_residents er
                    WHERE er.estate_id = visitor_arrival_requests.estate_id AND er.user_id = auth.uid()
                      AND er.role = 'estate_admin')
            );
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'visitor_arrival_requests' AND policyname = 'arrival_service') THEN
        CREATE POLICY "arrival_service" ON visitor_arrival_requests TO service_role
            USING (TRUE) WITH CHECK (TRUE);
    END IF;
END $$;

-- An approval admits ONE visit: the guard's admit consumes it (consumed_at) in the
-- same transaction as the code use. Separate ALTER so a table created by an
-- earlier apply of this migration also gets the column.
ALTER TABLE visitor_arrival_requests ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

-- ── PostgREST lockdown (ADR-PR858 pattern) ─────────────────────────────────────
-- Both tables are written and read only by the Go backend (service_role). Who is
-- at the gate for whom, and the guard roster, are not for other residents to
-- read through /rest/v1, so anon/authenticated get no privileges at all. The
-- SELECT policies above are kept narrow anyway (own rows + estate admins) as a
-- second line should a grant ever be re-added.
REVOKE ALL ON TABLE estate_staff_grants      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE visitor_arrival_requests FROM PUBLIC, anon, authenticated;
GRANT  ALL ON TABLE estate_staff_grants      TO service_role;
GRANT  ALL ON TABLE visitor_arrival_requests TO service_role;

-- ── Seed the Estate-Management merchant type for the CreateEstate gate ────────
-- The workplan (§2.1) requires an approved estate-manager merchant before a user
-- may create an estate. onboarding has no estate type today; seed one (idempotent)
-- so the server-side gate has a deterministic thing to check for an ACTIVE
-- onb_merchant_profile against. Gate enforcement is behind FEATURE_ESTATE_MERCHANT_GATE.
-- The role an approved estate manager receives. It carries NO permissions: it
-- marks the merchant identity only. (estate-admin is the platform-wide
-- estate.admin.* console role and must not be handed to every estate merchant.)
INSERT INTO roles (name, slug, description, role_type)
VALUES ('Estate Manager', 'estate-manager',
        'Approved estate-management merchant: may create estates. No platform permissions.', 'merchant')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO onb_module (id, slug, name, description, status, sort_order)
VALUES ('estate', 'estate', 'Estate Management',
        'Gated-community estate management and visitor access operations.', 'open', 60)
ON CONFLICT (id) DO NOTHING;

INSERT INTO onb_merchant_type
    (id, module_id, slug, name, description, required_kyc_tier, role_to_grant, status)
VALUES ('estate_management', 'estate', 'estate-management', 'Estate Manager',
        'Authorised to create and manage estates and delegate scoped staff roles.',
        0, 'estate-manager', 'open')
ON CONFLICT (id) DO NOTHING;
-- An earlier apply seeded the unprovisioned slug 'estate_manager'; point it at
-- the real role so onboarding approval can grant it.
UPDATE onb_merchant_type SET role_to_grant = 'estate-manager'
WHERE id = 'estate_management' AND role_to_grant = 'estate_manager';
