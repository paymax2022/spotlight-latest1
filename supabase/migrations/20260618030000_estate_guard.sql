-- Block 28: Security gate infrastructure — gates, guard shifts, incident reports
-- Additive only.

-- ── estate_gates ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estate_gates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id   UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    gate_type   VARCHAR(20) NOT NULL DEFAULT 'vehicle'
                CHECK (gate_type IN ('pedestrian','vehicle','service')),
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gates_estate ON estate_gates(estate_id);

ALTER TABLE estate_gates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Estate members view gates"
    ON estate_gates FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM estate_residents er
            WHERE er.estate_id = estate_gates.estate_id AND er.user_id = auth.uid()
        )
    );
CREATE POLICY "Estate admin manages gates"
    ON estate_gates FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM estate_residents er
            WHERE er.estate_id = estate_gates.estate_id
              AND er.user_id = auth.uid()
              AND er.role = 'estate_admin'
        )
    );

-- ── guard_shifts ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guard_shifts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guard_id         UUID NOT NULL REFERENCES auth.users(id),
    gate_id          UUID NOT NULL REFERENCES estate_gates(id) ON DELETE CASCADE,
    estate_id        UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at         TIMESTAMPTZ,
    handover_notes   TEXT,
    relieved_by      UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shifts_guard   ON guard_shifts(guard_id);
CREATE INDEX IF NOT EXISTS idx_shifts_gate    ON guard_shifts(gate_id);
CREATE INDEX IF NOT EXISTS idx_shifts_estate  ON guard_shifts(estate_id);
CREATE INDEX IF NOT EXISTS idx_shifts_active  ON guard_shifts(ended_at) WHERE ended_at IS NULL;

ALTER TABLE guard_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Guard manages own shifts"
    ON guard_shifts FOR ALL
    USING (guard_id = auth.uid());
CREATE POLICY "Estate admin views all shifts"
    ON guard_shifts FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM estate_residents er
            WHERE er.estate_id = guard_shifts.estate_id
              AND er.user_id = auth.uid()
              AND er.role = 'estate_admin'
        )
    );

-- ── gate_incident_reports ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gate_incident_reports (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id      UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    guard_id       UUID NOT NULL REFERENCES auth.users(id),
    gate_id        UUID REFERENCES estate_gates(id),
    incident_type  VARCHAR(50) NOT NULL,  -- trespassing|altercation|theft|suspicious|vehicle|medical|fire|other
    description    TEXT NOT NULL,
    evidence_url   TEXT,
    escalated      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_estate  ON gate_incident_reports(estate_id);
CREATE INDEX IF NOT EXISTS idx_incidents_guard   ON gate_incident_reports(guard_id);
CREATE INDEX IF NOT EXISTS idx_incidents_type    ON gate_incident_reports(incident_type);

ALTER TABLE gate_incident_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Guard submits own incidents"
    ON gate_incident_reports FOR INSERT
    WITH CHECK (guard_id = auth.uid());
CREATE POLICY "Guard views own incidents"
    ON gate_incident_reports FOR SELECT
    USING (guard_id = auth.uid());
CREATE POLICY "Estate admin views all incidents"
    ON gate_incident_reports FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM estate_residents er
            WHERE er.estate_id = gate_incident_reports.estate_id
              AND er.user_id = auth.uid()
              AND er.role = 'estate_admin'
        )
    );

-- ── offline_gate_logs ─────────────────────────────────────────────────────────
-- Receives batched events uploaded when a guard device comes back online.
CREATE TABLE IF NOT EXISTS offline_gate_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id       UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    guard_id        UUID NOT NULL REFERENCES auth.users(id),
    client_id       UUID NOT NULL UNIQUE,  -- idempotency key from device
    event_type      VARCHAR(30) NOT NULL,  -- checkin|checkout|incident|vehicle
    payload         JSONB NOT NULL DEFAULT '{}',
    captured_at     TIMESTAMPTZ NOT NULL,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offline_logs_guard   ON offline_gate_logs(guard_id);
CREATE INDEX IF NOT EXISTS idx_offline_logs_estate  ON offline_gate_logs(estate_id);

ALTER TABLE offline_gate_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Guard syncs own offline logs"
    ON offline_gate_logs FOR INSERT
    WITH CHECK (guard_id = auth.uid());
