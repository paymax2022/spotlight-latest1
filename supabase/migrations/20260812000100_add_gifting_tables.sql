-- Phase 2C: Gifting tables for wallet-to-wallet gift transactions

-- Gift catalog: available gifts users can send
CREATE TABLE IF NOT EXISTS gift_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Gift details
  name TEXT NOT NULL,
  description TEXT,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  image_url TEXT,
  category TEXT DEFAULT 'general',

  -- Availability
  is_available BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_gift_name UNIQUE (name)
);

-- Gift transactions: sent/received gifts
CREATE TABLE IF NOT EXISTS gift_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  reference TEXT NOT NULL UNIQUE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES gift_catalog(id),

  -- Payment details
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),

  -- Gift message
  message TEXT,

  -- Status lifecycle
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'received', 'claimed')),

  -- Idempotency for money-path safety
  idempotency_key TEXT UNIQUE,

  -- Audit trail
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_gift_per_recipient UNIQUE (sender_id, recipient_id, item_id, created_at)
);

-- Indexes
CREATE INDEX idx_gift_transactions_sender_id
  ON gift_transactions(sender_id);

CREATE INDEX idx_gift_transactions_recipient_id
  ON gift_transactions(recipient_id);

CREATE INDEX idx_gift_transactions_status
  ON gift_transactions(status);

CREATE INDEX idx_gift_transactions_created_at
  ON gift_transactions(created_at DESC);

-- Enable RLS: users can send/receive gifts, view their own transactions
ALTER TABLE gift_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active gift catalog"
  ON gift_catalog FOR SELECT
  USING (is_active = true);

CREATE POLICY "Users can view their sent gifts"
  ON gift_transactions FOR SELECT
  USING (sender_id = auth.uid());

CREATE POLICY "Users can view their received gifts"
  ON gift_transactions FOR SELECT
  USING (recipient_id = auth.uid());

-- Comments
COMMENT ON TABLE gift_catalog IS
  'Catalog of giftable items users can send to each other.';

COMMENT ON TABLE gift_transactions IS
  'Records of sent and received gifts with wallet-to-wallet money transfers.
   Uses Idempotency-Key for duplicate prevention on network retries.';

COMMENT ON COLUMN gift_transactions.idempotency_key IS
  'Unique key for idempotent gift sends. Prevents double-charging on retry.';

-- Seed initial gifts
INSERT INTO gift_catalog (name, description, amount_kobo, category)
VALUES
  ('Rose', 'A single rose flower', 50_000, 'flowers'),
  ('Coffee', 'A cup of coffee', 99_000, 'beverages'),
  ('Heart', 'A heart emoji gift', 150_000, 'gestures'),
  ('Bouquet', 'A beautiful bouquet', 300_000, 'flowers'),
  ('Crown', 'A crown emoji gift', 750_000, 'premium'),
  ('Diamond', 'A diamond emoji gift', 2_000_000, 'premium')
ON CONFLICT DO NOTHING;
