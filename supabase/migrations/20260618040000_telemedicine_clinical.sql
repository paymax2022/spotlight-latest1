-- Block 13 — Telemedicine clinical & scheduling additions.
-- Adds slot availability, immutable patient reviews, and patient-facing visit
-- summaries on top of the existing telemedicine + health_premium schema.
-- Additive-only — no DROP of data, no RENAME, no type narrowing.

-- ─── Widen consultation_type to match the mobile app (video/audio/chat) ───────
-- health_premium constrained this to ('video','in_person'); the patient app also
-- offers audio and chat consults. Widening a CHECK is additive (no rows lost).
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_consultation_type_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_consultation_type_check CHECK (
    consultation_type IN ('video','audio','chat','in_person')
);

-- Track an optional human-friendly booking reference for receipts / admin search.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS ref TEXT;
CREATE INDEX IF NOT EXISTS appointments_ref_idx ON appointments(ref);

-- ─── doctor_availability ─────────────────────────────────────────────────────
-- One row per bookable slot. Booking flips is_available -> FALSE; the UNIQUE
-- constraint plus the conditional update is what prevents double-booking a slot.
CREATE TABLE IF NOT EXISTS doctor_availability (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id     UUID NOT NULL REFERENCES doctors(id),
    slot_date     DATE NOT NULL,
    slot_time     TEXT NOT NULL,                       -- e.g. '09:00 AM'
    is_available  BOOLEAN NOT NULL DEFAULT TRUE,
    appointment_id UUID REFERENCES appointments(id),   -- set when booked
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (doctor_id, slot_date, slot_time)
);

CREATE INDEX IF NOT EXISTS doctor_availability_doctor_idx ON doctor_availability(doctor_id, slot_date);
CREATE INDEX IF NOT EXISTS doctor_availability_open_idx   ON doctor_availability(doctor_id) WHERE is_available = TRUE;

ALTER TABLE doctor_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "availability_select"  ON doctor_availability FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "availability_service" ON doctor_availability TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ─── reviews (immutable patient feedback) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS telemedicine_reviews (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID NOT NULL UNIQUE REFERENCES appointments(id),
    doctor_id      UUID NOT NULL REFERENCES doctors(id),
    patient_id     UUID NOT NULL REFERENCES auth.users(id),
    rating         SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment        TEXT NOT NULL DEFAULT '',
    is_hidden      BOOLEAN NOT NULL DEFAULT FALSE,      -- admin moderation flag
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reviews_doctor_idx  ON telemedicine_reviews(doctor_id);
CREATE INDEX IF NOT EXISTS reviews_patient_idx ON telemedicine_reviews(patient_id);

ALTER TABLE telemedicine_reviews ENABLE ROW LEVEL SECURITY;
-- Reviews are public to authenticated users (so doctor profiles can show them),
-- but only the author can create their own review.
CREATE POLICY "reviews_select" ON telemedicine_reviews FOR SELECT TO authenticated USING (is_hidden = FALSE OR patient_id = auth.uid());
CREATE POLICY "reviews_insert" ON telemedicine_reviews FOR INSERT TO authenticated WITH CHECK (patient_id = auth.uid());
CREATE POLICY "reviews_service" ON telemedicine_reviews TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ─── visit_summaries (patient-facing diagnosis & notes) ──────────────────────
-- Distinct from doctor_soap_notes (clinician-facing): this is the patient's
-- plain-language diagnosis / clinical notes / follow-up shown after a consult.
CREATE TABLE IF NOT EXISTS visit_summaries (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID NOT NULL UNIQUE REFERENCES appointments(id),
    doctor_id      UUID NOT NULL REFERENCES doctors(id),
    patient_id     UUID NOT NULL REFERENCES auth.users(id),
    diagnosis      TEXT NOT NULL DEFAULT '',
    notes          TEXT NOT NULL DEFAULT '',
    follow_up      TEXT NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS visit_summaries_patient_idx ON visit_summaries(patient_id);

ALTER TABLE visit_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "visit_summaries_select" ON visit_summaries FOR SELECT TO authenticated
    USING (
        patient_id = auth.uid()
        OR EXISTS (SELECT 1 FROM doctors d WHERE d.id = visit_summaries.doctor_id AND d.user_id = auth.uid())
    );
CREATE POLICY "visit_summaries_service" ON visit_summaries TO service_role USING (TRUE) WITH CHECK (TRUE);
