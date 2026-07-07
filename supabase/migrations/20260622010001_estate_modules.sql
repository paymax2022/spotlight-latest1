-- Blocks 29–37: Estate super-app modules — dues/payments, meetings, tasks,
-- repairs, facilities, announcements, emergencies, documents, vendors.
-- ADDITIVE ONLY (CREATE TABLE IF NOT EXISTS; no drops/renames/narrowing).
-- Money is in kobo (integer). Estate-scoped RLS mirrors 20260616250000_estate.sql;
-- the service-role API (createAdminClient) bypasses RLS. Every table carries
-- estate_id for uniform estate-scoped policies.

-- ── Block 29: Dues / Rent / Subscriptions ────────────────────────────────────
CREATE TABLE IF NOT EXISTS estate_dues_invoices (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id   UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    property_id UUID REFERENCES estate_properties(id) ON DELETE SET NULL,
    resident_id UUID NOT NULL REFERENCES auth.users(id),
    category    TEXT NOT NULL CHECK (category IN
                    ('service_charge','security_levy','waste','water','electricity','rent','facility','penalty','other')),
    amount_kobo BIGINT NOT NULL CHECK (amount_kobo >= 0),
    due_date    TIMESTAMPTZ NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','overdue','waived')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dues_estate    ON estate_dues_invoices (estate_id, status);
CREATE INDEX IF NOT EXISTS idx_dues_resident  ON estate_dues_invoices (resident_id, status);

CREATE TABLE IF NOT EXISTS estate_payments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id   UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    invoice_id  UUID REFERENCES estate_dues_invoices(id) ON DELETE SET NULL,
    payer_id    UUID NOT NULL REFERENCES auth.users(id),
    amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
    method      TEXT NOT NULL CHECK (method IN ('wallet','card','transfer','ussd')),
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','successful','failed','refunded')),
    reference   VARCHAR(80),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_estate ON estate_payments (estate_id, created_at DESC);
-- Idempotency: at most one payment row per Idempotency-Key (reference). Additive,
-- partial (NULLs allowed) so it never blocks rows that carry no reference.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_payments_reference ON estate_payments (reference) WHERE reference IS NOT NULL;

-- ── Block 30: Meetings ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estate_meetings (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id  UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    title      VARCHAR(200) NOT NULL,
    agenda     TEXT,
    mode       TEXT NOT NULL DEFAULT 'physical' CHECK (mode IN ('physical','virtual','hybrid')),
    location   TEXT,
    starts_at  TIMESTAMPTZ NOT NULL,
    ends_at    TIMESTAMPTZ,
    status     TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','ended','cancelled')),
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_meetings_estate ON estate_meetings (estate_id, starts_at DESC);

CREATE TABLE IF NOT EXISTS meeting_rsvps (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id  UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    meeting_id UUID NOT NULL REFERENCES estate_meetings(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES auth.users(id),
    response   TEXT NOT NULL CHECK (response IN ('yes','no','maybe')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (meeting_id, user_id)
);

CREATE TABLE IF NOT EXISTS meeting_minutes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id  UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    meeting_id UUID NOT NULL REFERENCES estate_meetings(id) ON DELETE CASCADE,
    content    TEXT NOT NULL DEFAULT '',
    decisions  JSONB DEFAULT '[]'::jsonb,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Block 31: Tasks ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estate_tasks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id   UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    title       VARCHAR(200) NOT NULL,
    description TEXT,
    assignee_id UUID REFERENCES auth.users(id),
    created_by  UUID NOT NULL REFERENCES auth.users(id),
    due_date    TIMESTAMPTZ,
    priority    TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
    status      TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tasks_estate ON estate_tasks (estate_id, status);

-- ── Block 32: Maintenance / Repairs ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estate_repair_requests (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id         UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    property_id       UUID REFERENCES estate_properties(id) ON DELETE SET NULL,
    reporter_id       UUID NOT NULL REFERENCES auth.users(id),
    category          TEXT NOT NULL CHECK (category IN
                          ('plumbing','electrical','gate','generator','elevator','water','waste','road','pest','facility','other')),
    description       TEXT NOT NULL,
    urgency           TEXT NOT NULL DEFAULT 'medium' CHECK (urgency IN ('low','medium','high')),
    status            TEXT NOT NULL DEFAULT 'reported' CHECK (status IN
                          ('reported','inspection','assigned','in_progress','completed','reopened','cancelled')),
    vendor_id         UUID,
    cost_estimate_kobo BIGINT CHECK (cost_estimate_kobo IS NULL OR cost_estimate_kobo >= 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_repairs_estate ON estate_repair_requests (estate_id, status);

CREATE TABLE IF NOT EXISTS repair_updates (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id  UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    request_id UUID NOT NULL REFERENCES estate_repair_requests(id) ON DELETE CASCADE,
    status     TEXT NOT NULL,
    note       TEXT,
    by_user    UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Block 33: Facilities / Amenities ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estate_facilities (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id  UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    name       VARCHAR(200) NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'other',
    capacity   INT,
    fee_kobo   BIGINT NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS facility_bookings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id   UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    facility_id UUID NOT NULL REFERENCES estate_facilities(id) ON DELETE CASCADE,
    resident_id UUID NOT NULL REFERENCES auth.users(id),
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','refunded')),
    amount_kobo BIGINT NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_bookings_facility ON facility_bookings (facility_id, starts_at);

-- ── Block 34: Announcements / Communication ──────────────────────────────────
CREATE TABLE IF NOT EXISTS estate_announcements (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id  UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    title      VARCHAR(200) NOT NULL,
    body       TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'general' CHECK (kind IN
                   ('general','emergency','security','payment','maintenance','meeting','election')),
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_announcements_estate ON estate_announcements (estate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS announcement_reads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id       UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    announcement_id UUID NOT NULL REFERENCES estate_announcements(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES auth.users(id),
    read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (announcement_id, user_id)
);

-- ── Block 35: Emergencies / Incidents ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estate_emergency_alerts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id   UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    reporter_id UUID NOT NULL REFERENCES auth.users(id),
    kind        TEXT NOT NULL CHECK (kind IN ('panic','medical','fire','security','noise','theft','domestic','other')),
    description TEXT,
    location    TEXT,
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','responding','resolved')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_emergencies_estate ON estate_emergency_alerts (estate_id, created_at DESC);

-- ── Block 36: Documents ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estate_documents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id   UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    title       VARCHAR(200) NOT NULL,
    category    TEXT NOT NULL DEFAULT 'general',
    file_url    TEXT NOT NULL,
    uploaded_by UUID NOT NULL REFERENCES auth.users(id),
    restricted  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_documents_estate ON estate_documents (estate_id, category);

-- ── Block 37: Vendors / Artisans ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estate_vendors (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id  UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    user_id    UUID REFERENCES auth.users(id),
    name       VARCHAR(200) NOT NULL,
    category   TEXT NOT NULL DEFAULT 'general',
    phone      VARCHAR(30),
    status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','suspended')),
    rating     NUMERIC(2,1) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendor_jobs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id         UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    vendor_id         UUID NOT NULL REFERENCES estate_vendors(id) ON DELETE CASCADE,
    repair_request_id UUID REFERENCES estate_repair_requests(id) ON DELETE SET NULL,
    status            TEXT NOT NULL DEFAULT 'available' CHECK (status IN
                          ('available','accepted','rejected','en_route','in_progress','completed','paid')),
    amount_kobo       BIGINT NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendor_jobs_vendor ON vendor_jobs (vendor_id, status);

-- ── RLS: estate-scoped read for residents/admins + service-role bypass ───────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'estate_dues_invoices','estate_payments','estate_meetings','meeting_rsvps','meeting_minutes',
    'estate_tasks','estate_repair_requests','repair_updates','estate_facilities','facility_bookings',
    'estate_announcements','announcement_reads','estate_emergency_alerts','estate_documents',
    'estate_vendors','vendor_jobs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY %1$I ON %2$I FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM estate_residents er WHERE er.estate_id = %2$I.estate_id AND er.user_id = auth.uid()))
    $p$, t || '_select', t);
    EXECUTE format('CREATE POLICY %1$I ON %2$I TO service_role USING (TRUE) WITH CHECK (TRUE)', t || '_service', t);
  END LOOP;
END $$;
