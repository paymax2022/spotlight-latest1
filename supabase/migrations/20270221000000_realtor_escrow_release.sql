-- Realtor module — inspection-gated escrow deposit release (PROPMGMT-002).
-- ADDITIVE ONLY. realtor_escrow_deposits (20260620010000) has no release/refund/
-- dispute mechanism at all: money paid in via realtor_pay_invoice never comes
-- back out. This migration adds the move-out inspection record that gates
-- release, plus resolution bookkeeping columns on the existing escrow table.
-- Money is BIGINT minor units (kobo). Does NOT touch the existing
-- realtor_escrow_deposits.status CHECK constraint — new nullable columns only.

-- ── Move-out (mirrors realtor_move_ins) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS realtor_move_outs (
    lease_id      UUID PRIMARY KEY REFERENCES realtor_leases(id) ON DELETE CASCADE,
    checklist     JSONB NOT NULL DEFAULT '[]'::JSONB,
    submitted_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE realtor_move_outs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant manages own move-out"
    ON realtor_move_outs FOR ALL
    USING (EXISTS (SELECT 1 FROM realtor_leases l WHERE l.id = realtor_move_outs.lease_id AND l.tenant_id = auth.uid()));

-- ── Escrow resolution bookkeeping (additive columns only) ──────────────────────
-- resolved_to / resolution_note / resolved_by record HOW an escrow deposit's
-- 'released'/'disputed' status was reached, for the admin resolve endpoint
-- (POST /api/realtor/admin/escrow/:id/resolve). The existing
-- status IN ('held','release_requested','released','disputed') CHECK is
-- untouched.
ALTER TABLE realtor_escrow_deposits ADD COLUMN IF NOT EXISTS resolved_to TEXT CHECK (resolved_to IN ('tenant','landlord'));
ALTER TABLE realtor_escrow_deposits ADD COLUMN IF NOT EXISTS resolution_note TEXT;
ALTER TABLE realtor_escrow_deposits ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES auth.users(id);
