-- Block 27: Extended visitor access codes & check-in log
-- Additive only. Extends the existing visitor_passes model.

-- ── visitor_access_codes ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor_access_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id       UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    issued_by       UUID NOT NULL REFERENCES auth.users(id),
    visitor_name    VARCHAR(200) NOT NULL,
    visitor_phone   VARCHAR(30),
    vehicle_plate   VARCHAR(20),
    purpose         TEXT,
    code_type       VARCHAR(30) NOT NULL DEFAULT 'one_time'
                    CHECK (code_type IN (
                        'one_time','recurring','multi_day','delivery',
                        'ridehailing','staff','contractor','event_guest','family'
                    )),
    numeric_code    VARCHAR(6) NOT NULL,
    qr_code         UUID NOT NULL DEFAULT gen_random_uuid(),
    valid_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until     TIMESTAMPTZ NOT NULL,
    recurrence      JSONB DEFAULT NULL,  -- {days_of_week:[1,2,3], time_start:"08:00", time_end:"18:00"}
    used_count      INT NOT NULL DEFAULT 0,
    max_uses        INT NOT NULL DEFAULT 1,
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','used','expired','revoked')),
    blacklisted     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- numeric_code must be unique per estate within any active window
CREATE UNIQUE INDEX IF NOT EXISTS uq_visitor_code_active
    ON visitor_access_codes(estate_id, numeric_code)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_visitor_codes_estate   ON visitor_access_codes(estate_id);
CREATE INDEX IF NOT EXISTS idx_visitor_codes_issued   ON visitor_access_codes(issued_by);
CREATE INDEX IF NOT EXISTS idx_visitor_codes_qr       ON visitor_access_codes(qr_code);
CREATE INDEX IF NOT EXISTS idx_visitor_codes_valid    ON visitor_access_codes(valid_until);

ALTER TABLE visitor_access_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Resident manages own codes"
    ON visitor_access_codes FOR ALL
    USING (issued_by = auth.uid());
CREATE POLICY "Estate members view all active codes"
    ON visitor_access_codes FOR SELECT
    USING (
        status = 'active' AND EXISTS (
            SELECT 1 FROM estate_residents er
            WHERE er.estate_id = visitor_access_codes.estate_id AND er.user_id = auth.uid()
        )
    );

-- ── visitor_checkins ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor_checkins (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code_id      UUID NOT NULL REFERENCES visitor_access_codes(id) ON DELETE CASCADE,
    guard_id     UUID REFERENCES auth.users(id),
    gate_id      VARCHAR(80),
    event        VARCHAR(20) NOT NULL CHECK (event IN ('arrived','checked_out')),
    captured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    photo_url    TEXT
);

CREATE INDEX IF NOT EXISTS idx_checkins_code    ON visitor_checkins(code_id);
CREATE INDEX IF NOT EXISTS idx_checkins_time    ON visitor_checkins(captured_at);
CREATE INDEX IF NOT EXISTS idx_checkins_guard   ON visitor_checkins(guard_id);

ALTER TABLE visitor_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Code owner views checkins"
    ON visitor_checkins FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM visitor_access_codes vc
            WHERE vc.id = visitor_checkins.code_id AND vc.issued_by = auth.uid()
        )
    );
CREATE POLICY "Guards insert checkins"
    ON visitor_checkins FOR INSERT
    WITH CHECK (guard_id = auth.uid());
