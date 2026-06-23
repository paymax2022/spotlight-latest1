-- Events & Tickets module.
-- Additive-only — no DROP, no RENAME, no type narrowing.

-- ─── events ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizer_id  UUID NOT NULL REFERENCES auth.users(id),
    title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
    description   TEXT,
    venue_address TEXT,
    starts_at     TIMESTAMPTZ NOT NULL,
    ends_at       TIMESTAMPTZ NOT NULL,
    banner_url    TEXT,
    status        TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','published','cancelled','completed')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS events_organizer_idx ON events(organizer_id);
CREATE INDEX IF NOT EXISTS events_status_idx    ON events(status);
CREATE INDEX IF NOT EXISTS events_starts_at_idx ON events(starts_at);

-- ─── event_ticket_types ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_ticket_types (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    price_kobo  BIGINT NOT NULL DEFAULT 0 CHECK (price_kobo >= 0),
    capacity    INT  NOT NULL DEFAULT 0 CHECK (capacity >= 0), -- 0 = unlimited
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS event_ticket_types_event_idx ON event_ticket_types(event_id);

-- ─── event_tickets ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_tickets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID NOT NULL REFERENCES events(id),
    ticket_type_id  UUID NOT NULL REFERENCES event_ticket_types(id),
    owner_id        UUID NOT NULL REFERENCES auth.users(id),
    qr_code         UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    status          TEXT NOT NULL DEFAULT 'issued'
                        CHECK (status IN ('issued','used','refunded','cancelled')),
    price_paid_kobo BIGINT NOT NULL DEFAULT 0 CHECK (price_paid_kobo >= 0),
    idempotency_key TEXT NOT NULL,
    scanned_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS event_tickets_owner_idx  ON event_tickets(owner_id);
CREATE INDEX IF NOT EXISTS event_tickets_event_idx  ON event_tickets(event_id);
CREATE INDEX IF NOT EXISTS event_tickets_qr_idx     ON event_tickets(qr_code);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_ticket_types  ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_tickets       ENABLE ROW LEVEL SECURITY;

-- Published events are publicly readable; draft events only by the organiser.
CREATE POLICY "events_select" ON events FOR SELECT
    TO authenticated
    USING (status IN ('published','completed') OR organizer_id = auth.uid());

CREATE POLICY "events_insert" ON events FOR INSERT
    TO authenticated
    WITH CHECK (organizer_id = auth.uid());

CREATE POLICY "events_update" ON events FOR UPDATE
    TO authenticated
    USING (organizer_id = auth.uid());

CREATE POLICY "ticket_types_select" ON event_ticket_types FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM events e
            WHERE e.id = event_ticket_types.event_id
              AND (e.status IN ('published','completed') OR e.organizer_id = auth.uid())
        )
    );

CREATE POLICY "ticket_types_insert" ON event_ticket_types FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (SELECT 1 FROM events e WHERE e.id = event_ticket_types.event_id AND e.organizer_id = auth.uid())
    );

CREATE POLICY "tickets_select" ON event_tickets FOR SELECT
    TO authenticated
    USING (
        owner_id = auth.uid()
        OR EXISTS (SELECT 1 FROM events e WHERE e.id = event_tickets.event_id AND e.organizer_id = auth.uid())
    );

-- Service role bypasses RLS.
CREATE POLICY "events_service_role"        ON events             TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "ticket_types_service_role"  ON event_ticket_types TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "tickets_service_role"       ON event_tickets      TO service_role USING (TRUE) WITH CHECK (TRUE);
