-- Telemedicine module: doctors, appointments, prescriptions.
-- Additive-only — no DROP, no RENAME, no type narrowing.

-- ─── doctors ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL UNIQUE REFERENCES auth.users(id),
    name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 200),
    specialty       TEXT NOT NULL DEFAULT 'general'
                        CHECK (specialty IN ('general','cardiology','dermatology','paediatrics','veterinary','pharmacy')),
    bio             TEXT,
    consult_fee_kobo BIGINT NOT NULL CHECK (consult_fee_kobo >= 100),
    avatar_url      TEXT,
    is_available    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS doctors_specialty_idx    ON doctors(specialty);
CREATE INDEX IF NOT EXISTS doctors_available_idx    ON doctors(is_available);

-- ─── appointments ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID NOT NULL REFERENCES auth.users(id),
    doctor_id       UUID NOT NULL REFERENCES doctors(id),
    scheduled_at    TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'booked'
                        CHECK (status IN ('booked','confirmed','completed','cancelled')),
    notes           TEXT,
    fee_kobo        BIGINT NOT NULL CHECK (fee_kobo >= 0),
    idempotency_key TEXT NOT NULL,
    settlement_id   UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS appointments_patient_idx  ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS appointments_doctor_idx   ON appointments(doctor_id);
CREATE INDEX IF NOT EXISTS appointments_status_idx   ON appointments(status);

-- ─── prescriptions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prescriptions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID NOT NULL UNIQUE REFERENCES appointments(id),
    doctor_id      UUID NOT NULL REFERENCES doctors(id),
    patient_id     UUID NOT NULL REFERENCES auth.users(id),
    medications    TEXT NOT NULL,
    instructions   TEXT,
    issued_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS prescriptions_patient_idx ON prescriptions(patient_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE doctors        ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions  ENABLE ROW LEVEL SECURITY;

-- Doctors list is public to authenticated users.
CREATE POLICY "doctors_select"  ON doctors FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "doctors_insert"  ON doctors FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "doctors_update"  ON doctors FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- Appointments visible to patient and doctor.
CREATE POLICY "appointments_select" ON appointments FOR SELECT TO authenticated
    USING (
        patient_id = auth.uid()
        OR EXISTS (SELECT 1 FROM doctors d WHERE d.id = appointments.doctor_id AND d.user_id = auth.uid())
    );

CREATE POLICY "appointments_insert" ON appointments FOR INSERT TO authenticated WITH CHECK (patient_id = auth.uid());

-- Prescriptions visible to patient and issuing doctor.
CREATE POLICY "prescriptions_select" ON prescriptions FOR SELECT TO authenticated
    USING (
        patient_id = auth.uid()
        OR EXISTS (SELECT 1 FROM doctors d WHERE d.id = prescriptions.doctor_id AND d.user_id = auth.uid())
    );

-- Service role bypasses all RLS.
CREATE POLICY "doctors_service"       ON doctors       TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "appointments_service"  ON appointments  TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "prescriptions_service" ON prescriptions TO service_role USING (TRUE) WITH CHECK (TRUE);
