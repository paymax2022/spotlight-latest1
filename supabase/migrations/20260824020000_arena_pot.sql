-- Arena prize-pot disbursement state machine (ADR-014 §12, NDC-4). ADDITIVE ONLY.
-- The pot TOTAL is always a projection over arena_support_txn (never a stored
-- mutable balance). This table holds ONLY the disbursement control state:
-- distinct multi-approval records and a single idempotent DISBURSED flip.
-- No DROP / RENAME / type-narrowing. Safe to re-run.

-- One control row per competition, created lazily on first approval/disburse.
CREATE TABLE IF NOT EXISTS arena_pot_disbursement (
  competition_id UUID PRIMARY KEY REFERENCES arena_competition(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','DISBURSED')),
  idempotency_key TEXT,                       -- set atomically with the payout
  disbursed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Distinct approvers (NDC-4 multi-approve). One row per (competition, approver);
-- the unique constraint makes a repeated approval a safe no-op.
CREATE TABLE IF NOT EXISTS arena_pot_approval (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES arena_competition(id) ON DELETE CASCADE,
  approver_id    UUID NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (competition_id, approver_id)
);
CREATE INDEX IF NOT EXISTS arena_pot_approval_comp_idx ON arena_pot_approval (competition_id);
