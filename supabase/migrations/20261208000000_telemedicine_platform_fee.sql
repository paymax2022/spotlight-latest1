-- Telemedicine platform booking fee (ADR-040).
-- Additive-only — no DROP, no RENAME, no type narrowing.
--
-- The 5% platform booking fee becomes server-authoritative and is ADDITIVE to the
-- patient: they pay consult + fee, the doctor still receives 85% of the consult
-- fee, and the platform receives 15% of consult + the whole fee.
--
-- fee_kobo KEEPS its existing meaning — the doctor's CONSULTATION fee. It is not
-- widened to mean "total", because the doctor-earnings queries in
-- backend/internal/telemedicine/service.go compute SUM(fee_kobo * 0.85); widening
-- it would silently pay doctors 85% of the platform's own fee as well.

ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS platform_fee_kobo BIGINT NOT NULL DEFAULT 0;

ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS total_kobo BIGINT NOT NULL DEFAULT 0;

-- Money columns are never negative. Added NOT VALID-free (the table is small and
-- the backfill below makes every existing row satisfy them).
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_platform_fee_kobo_nonneg;
ALTER TABLE appointments
    ADD CONSTRAINT appointments_platform_fee_kobo_nonneg CHECK (platform_fee_kobo >= 0);

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_total_kobo_nonneg;
ALTER TABLE appointments
    ADD CONSTRAINT appointments_total_kobo_nonneg CHECK (total_kobo >= 0);

-- Backfill: every appointment booked before this migration escrowed the
-- consultation fee ALONE (BookAppointment passed doctor.consult_fee_kobo to
-- settlement.Escrow), so its true escrowed total is fee_kobo and its platform fee
-- is 0. Writing that explicitly keeps total_kobo a faithful record of what was
-- actually escrowed rather than a DEFAULT-0 placeholder that would read as "this
-- patient paid nothing".
--
-- The 0 platform fee is also what makes these rows settle unchanged: Split's
-- ServiceFeeKobo = 0 reproduces the old pure 85/15 split exactly.
UPDATE appointments
   SET total_kobo = fee_kobo
 WHERE total_kobo = 0
   AND fee_kobo > 0;

COMMENT ON COLUMN appointments.fee_kobo IS
    'Doctor consultation fee in kobo (excludes the platform booking fee). Doctor earnings are 85% of this. NOT a patient-facing total — see total_kobo (ADR-040).';
COMMENT ON COLUMN appointments.platform_fee_kobo IS
    'Platform booking fee in kobo, computed server-side as consult_fee_kobo * 500 / 10000 (floored). Settled as a 100%-platform leg via settlement.Split.ServiceFeeKobo. 0 for pre-ADR-040 rows.';
COMMENT ON COLUMN appointments.total_kobo IS
    'Amount actually escrowed = fee_kobo + platform_fee_kobo. What the patient paid, and what a cancellation refunds in full (ADR-040).';
