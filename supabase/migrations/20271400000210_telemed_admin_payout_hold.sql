-- Telemedicine admin finance decisions (backend/internal/telemedadmin/finance/actions.go).
-- Additive only: hold + approval markers on doctor_payouts, and an index so the
-- Idempotency-Key replay lookup on doctor_compliance_audit is not a seq scan.
-- A held payout stays status='pending' (the CHECK constraint is left untouched).

ALTER TABLE public.doctor_payouts
    ADD COLUMN IF NOT EXISTS held_at     timestamptz,
    ADD COLUMN IF NOT EXISTS hold_reason text,
    ADD COLUMN IF NOT EXISTS approved_at timestamptz,
    ADD COLUMN IF NOT EXISTS approved_by uuid;

CREATE INDEX IF NOT EXISTS idx_doctor_compliance_audit_idem
    ON public.doctor_compliance_audit (idempotency_key)
    WHERE idempotency_key IS NOT NULL;
