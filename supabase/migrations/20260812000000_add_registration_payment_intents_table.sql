-- Phase 2B: Registration payment intents table for contest registration payments.
-- Tracks payment attempts for applications with Idempotency-Key deduplication.

CREATE TABLE IF NOT EXISTS registration_payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  application_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,

  -- Payment details
  reference TEXT NOT NULL UNIQUE,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),

  -- Payment method
  method TEXT NOT NULL CHECK (method IN ('WALLET', 'PAYSTACK')),

  -- Idempotency for money-path safety
  idempotency_key TEXT NOT NULL UNIQUE,

  -- Paystack-specific
  paystack_reference TEXT,

  -- Status lifecycle
  status TEXT NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated', 'completed', 'verified', 'failed')),

  -- Audit trail
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_payment_per_app_method UNIQUE (application_id, method)
);

CREATE INDEX idx_registration_payment_intents_app_id
  ON registration_payment_intents(application_id);

CREATE INDEX idx_registration_payment_intents_idempotency_key
  ON registration_payment_intents(idempotency_key);

CREATE INDEX idx_registration_payment_intents_status
  ON registration_payment_intents(status);

-- Enable RLS: users can see their own payments
ALTER TABLE registration_payment_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own payment intents"
  ON registration_payment_intents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM registrations
      WHERE registrations.id = registration_payment_intents.application_id
      AND registrations.user_id = auth.uid()
    )
  );

-- Comments
COMMENT ON TABLE registration_payment_intents IS
  'Payment intents for contest registration. Tracks payment attempts (WALLET or PAYSTACK)
   with Idempotency-Key deduplication for money-path safety.';

COMMENT ON COLUMN registration_payment_intents.idempotency_key IS
  'Unique key for idempotent payment retries. Prevents double-charging on network failures.';

COMMENT ON COLUMN registration_payment_intents.paystack_reference IS
  'Reference from Paystack provider after verification.';
