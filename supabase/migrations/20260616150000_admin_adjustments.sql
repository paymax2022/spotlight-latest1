-- Block 9: Fintech Admin RBAC — manual wallet adjustment (maker-checker)
-- Additive-only. No DROP, no RENAME, no type narrowing.

-- ── admin_adjustments ─────────────────────────────────────────────────────────
-- One row per proposed manual credit or debit.
-- Adjustments ≥ ₦100,000 (10,000,000 kobo) require checker approval.
-- Adjustments below that threshold execute immediately on initiation.

CREATE TABLE IF NOT EXISTS admin_adjustments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key   TEXT        NOT NULL UNIQUE,

  -- Who proposed this adjustment
  initiator_id      UUID        NOT NULL REFERENCES auth.users(id),
  initiator_role    TEXT        NOT NULL,

  -- Target wallet
  target_user_id    UUID        NOT NULL REFERENCES auth.users(id),

  -- Adjustment details
  type              TEXT        NOT NULL CHECK (type IN ('CREDIT', 'DEBIT')),
  amount_kobo       BIGINT      NOT NULL CHECK (amount_kobo > 0),
  reason            TEXT        NOT NULL,

  -- Execution state
  status            TEXT        NOT NULL DEFAULT 'pending_approval'
                                CHECK (status IN (
                                  'pending_approval',  -- awaiting checker (≥ ₦100k)
                                  'executed',          -- applied to ledger
                                  'rejected',          -- checker rejected
                                  'cancelled'          -- initiator cancelled before approval
                                )),

  -- Approval / rejection chain
  checker_id        UUID        REFERENCES auth.users(id),
  checker_role      TEXT,
  checker_note      TEXT,
  checked_at        TIMESTAMPTZ,

  -- Ledger trace
  ledger_entry_id   UUID,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Self-approval is blocked at service layer and here as belt-and-suspenders
  CONSTRAINT no_self_approval CHECK (checker_id IS NULL OR checker_id <> initiator_id)
);

CREATE INDEX IF NOT EXISTS admin_adjustments_status_idx
  ON admin_adjustments(status, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_adjustments_target_idx
  ON admin_adjustments(target_user_id);

-- RLS: only service_role writes; admin dashboard reads via service_role client
ALTER TABLE admin_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_adjustments_service_role"
  ON admin_adjustments FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
