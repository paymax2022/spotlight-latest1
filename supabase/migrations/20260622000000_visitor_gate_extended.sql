-- Block 28: Visitor/Gate extended schema (gate ops, notifications, blacklist,
-- incidents, push tokens) + access-code usage_mode/party_size.
-- ADDITIVE ONLY: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, no drops,
-- no renames, no type narrowing. Backs the mobile Visitor module live endpoints
-- (/api/v1/visitor/*). Estate-scoped RLS mirrors 20260616250000_estate.sql; the
-- service-role API (createAdminClient) bypasses RLS.

-- ── visitor_access_codes: usage mode + party size (client contract) ───────────
ALTER TABLE visitor_access_codes
    ADD COLUMN IF NOT EXISTS usage_mode TEXT NOT NULL DEFAULT 'one_time'
        CHECK (usage_mode IN ('entry_exit','one_time'));
ALTER TABLE visitor_access_codes
    ADD COLUMN IF NOT EXISTS party_size INT NOT NULL DEFAULT 1
        CHECK (party_size >= 1);

-- ── visitor_gate_events ──────────────────────────────────────────────────────
-- Full guard event log (arrival/check-in/out/deny/walk-in/emergency). Separate
-- from visitor_checkins (arrived/checked_out) so the existing flow is untouched.
CREATE TABLE IF NOT EXISTS visitor_gate_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id       UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    access_code_id  UUID REFERENCES visitor_access_codes(id) ON DELETE SET NULL,
    visitor_name    VARCHAR(200) NOT NULL,
    unit_label      TEXT NOT NULL DEFAULT '',
    gate_id         VARCHAR(80),
    guard_id        UUID REFERENCES auth.users(id),
    action          TEXT NOT NULL CHECK (action IN
                        ('arrival','check_in','check_out','deny','walk_in','emergency')),
    reason          TEXT,
    captured_plate  VARCHAR(20),
    sync_status     TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced','pending')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gate_events_estate   ON visitor_gate_events (estate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gate_events_code     ON visitor_gate_events (access_code_id);

-- ── gate_sessions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gate_sessions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id      UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    gate_id        VARCHAR(80) NOT NULL,
    gate_label     TEXT NOT NULL DEFAULT '',
    guard_id       UUID NOT NULL REFERENCES auth.users(id),
    guard_name     TEXT NOT NULL DEFAULT '',
    shift_start    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    shift_end      TIMESTAMPTZ,
    handover_notes TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gate_sessions_estate ON gate_sessions (estate_id, shift_start DESC);

-- ── visitor_blacklist ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor_blacklist (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id   UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    match_kind  TEXT NOT NULL CHECK (match_kind IN ('phone','id','plate')),
    match_value VARCHAR(120) NOT NULL,
    name        VARCHAR(200),
    reason      TEXT NOT NULL,
    created_by  UUID NOT NULL REFERENCES auth.users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_blacklist_estate ON visitor_blacklist (estate_id, created_at DESC);

-- ── visitor_incidents ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor_incidents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id   UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    gate_id     VARCHAR(80),
    kind        TEXT NOT NULL CHECK (kind IN ('suspicious','incident')),
    severity    TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
    title       VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    escalate    BOOLEAN NOT NULL DEFAULT FALSE,
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','escalated','resolved')),
    created_by  UUID NOT NULL REFERENCES auth.users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_incidents_estate ON visitor_incidents (estate_id, created_at DESC);

-- ── visitor_notifications ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor_notifications (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id      UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES auth.users(id),
    type           TEXT NOT NULL CHECK (type IN
                       ('arrival','checked_in','checked_out','overstayed','denied','restriction','access_restored')),
    title          TEXT NOT NULL,
    body           TEXT NOT NULL,
    access_code_id UUID REFERENCES visitor_access_codes(id) ON DELETE SET NULL,
    read           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visitor_notif_user ON visitor_notifications (user_id, created_at DESC);

-- ── device_push_tokens (Expo push targeting) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS device_push_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL,
    platform   TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, token)
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE visitor_gate_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor_blacklist    ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor_incidents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_push_tokens   ENABLE ROW LEVEL SECURITY;

-- Estate-scoped read for residents/admins of the estate.
CREATE POLICY "gate_events_select" ON visitor_gate_events FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM estate_residents er WHERE er.estate_id = visitor_gate_events.estate_id AND er.user_id = auth.uid()));
CREATE POLICY "gate_sessions_select" ON gate_sessions FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM estate_residents er WHERE er.estate_id = gate_sessions.estate_id AND er.user_id = auth.uid()));
CREATE POLICY "blacklist_select" ON visitor_blacklist FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM estate_residents er WHERE er.estate_id = visitor_blacklist.estate_id AND er.user_id = auth.uid()));
CREATE POLICY "incidents_select" ON visitor_incidents FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM estate_residents er WHERE er.estate_id = visitor_incidents.estate_id AND er.user_id = auth.uid()));
-- Notifications + tokens are private to the owning user.
CREATE POLICY "visitor_notif_select" ON visitor_notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "push_tokens_rw" ON device_push_tokens FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Service role (createAdminClient) bypasses RLS for the API layer.
CREATE POLICY "gate_events_service"   ON visitor_gate_events  TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "gate_sessions_service" ON gate_sessions        TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "blacklist_service"     ON visitor_blacklist    TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "incidents_service"     ON visitor_incidents    TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "visitor_notif_service" ON visitor_notifications TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "push_tokens_service"   ON device_push_tokens   TO service_role USING (TRUE) WITH CHECK (TRUE);
