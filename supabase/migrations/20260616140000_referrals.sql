-- Block 8: Referral codes and reward events
-- Additive-only. No DROP, no RENAME, no type narrowing.

-- ── finance_referral_codes ────────────────────────────────────────────────────────────
-- One code per user. Auto-generated as SPOT-XXXXXX.

CREATE TABLE IF NOT EXISTS finance_referral_codes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL UNIQUE REFERENCES auth.users(id),
  code       TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finance_referral_codes_code_idx ON finance_referral_codes(code);

ALTER TABLE finance_referral_codes ENABLE ROW LEVEL SECURITY;

-- Users can read their own code; service_role manages inserts
CREATE POLICY "finance_referral_codes_owner_select"
  ON finance_referral_codes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "finance_referral_codes_service_role"
  ON finance_referral_codes FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── referral_events ───────────────────────────────────────────────────────────
-- One row per successful referral reward. UNIQUE(referrer_id, referred_id)
-- enforces at-most-once semantics — a user can only be referred once.

CREATE TABLE IF NOT EXISTS referral_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id     UUID        NOT NULL REFERENCES auth.users(id),
  referred_id     UUID        NOT NULL REFERENCES auth.users(id),
  idempotency_key TEXT        NOT NULL UNIQUE,
  amount_kobo     BIGINT      NOT NULL DEFAULT 50000,  -- ₦500 reward
  ledger_entry_id UUID,                               -- the CREDIT entry created
  rewarded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT referral_no_self CHECK (referrer_id <> referred_id),
  CONSTRAINT referral_one_per_user UNIQUE (referrer_id, referred_id)
);

CREATE INDEX IF NOT EXISTS referral_events_referrer_idx ON referral_events(referrer_id);

ALTER TABLE referral_events ENABLE ROW LEVEL SECURITY;

-- Users can see their own referral earnings; service_role manages inserts
CREATE POLICY "referral_events_referrer_select"
  ON referral_events FOR SELECT
  USING (auth.uid() = referrer_id);

CREATE POLICY "referral_events_service_role"
  ON referral_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
