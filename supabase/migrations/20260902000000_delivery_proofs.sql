-- DP-006: Pharmacy delivery proof-of-delivery (POD) table.
-- Immutable record of proof captured when a delivery is completed (IN_DELIVERY → DELIVERED).
-- Supports multiple proof types (OTP, SIGNATURE, PHOTO) and optional verification state.

CREATE TABLE IF NOT EXISTS pharmacy_delivery_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  proof_type TEXT NOT NULL
    CHECK (proof_type IN ('OTP', 'SIGNATURE', 'PHOTO')),
  proof_data TEXT NOT NULL
    CHECK (proof_data <> ''),
  captured_by UUID NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  note TEXT
    CHECK (note IS NULL OR LENGTH(note) > 0),
  recipient_name TEXT
    CHECK (recipient_name IS NULL OR LENGTH(recipient_name) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_pharmacy_delivery_proof_order
    FOREIGN KEY (order_id)
    REFERENCES pharmacy_orders(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_pharmacy_delivery_proof_driver
    FOREIGN KEY (captured_by)
    REFERENCES auth.users(id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_delivery_proofs_order_id
  ON pharmacy_delivery_proofs (order_id);

CREATE INDEX IF NOT EXISTS idx_pharmacy_delivery_proofs_captured_by
  ON pharmacy_delivery_proofs (captured_by);

COMMENT ON TABLE pharmacy_delivery_proofs IS
  'Immutable proof-of-delivery records (DP-006). Captured when a delivery is confirmed (IN_DELIVERY → DELIVERED). Supports OTP, signature, photo proof types.';

COMMENT ON COLUMN pharmacy_delivery_proofs.captured_by IS
  'driver/courier user_id who captured the proof';

COMMENT ON COLUMN pharmacy_delivery_proofs.verified_at IS
  'null until verified by a ProofVerifier seam (e.g. OTP validation, signature OCR)';
