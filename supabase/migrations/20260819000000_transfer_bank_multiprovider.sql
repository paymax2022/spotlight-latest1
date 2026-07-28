-- Migration: transfer_bank_multiprovider
-- Adds multi-provider (Paystack + Monnify) bank payouts, bank→bank pass-through,
-- and a transaction PIN to the money-path transfer module.
-- ADDITIVE ONLY. No DROP of tables/columns, no renames, no type narrowing.
--   * Column adds use ADD COLUMN IF NOT EXISTS.
--   * The status CHECK is widened (drop+recreate of a value-set check = the
--     accepted additive pattern); a NOT NULL is RELAXED (widening), never added.
--   * Money is BIGINT kobo. Balances stay ledger projections.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) bank_transfers — generalize beyond Paystack + add bank→bank source.
-- ─────────────────────────────────────────────────────────────────────────────
-- Relax the Paystack-specific NOT NULL so Monnify / bank→bank rows are valid.
ALTER TABLE public.bank_transfers ALTER COLUMN paystack_recipient_code DROP NOT NULL;

ALTER TABLE public.bank_transfers ADD COLUMN IF NOT EXISTS provider               TEXT NOT NULL DEFAULT 'paystack';
ALTER TABLE public.bank_transfers ADD COLUMN IF NOT EXISTS provider_recipient_code TEXT;
ALTER TABLE public.bank_transfers ADD COLUMN IF NOT EXISTS provider_transfer_code  TEXT;
ALTER TABLE public.bank_transfers ADD COLUMN IF NOT EXISTS provider_transfer_ref   TEXT;
-- 'wallet' = wallet→bank (debit the user wallet); 'bank' = bank→bank pass-through
-- (funds collected via the provider into provider_clearing, then disbursed).
ALTER TABLE public.bank_transfers ADD COLUMN IF NOT EXISTS source_type            TEXT NOT NULL DEFAULT 'wallet';
ALTER TABLE public.bank_transfers ADD COLUMN IF NOT EXISTS funding_reference      TEXT;  -- collection ref (bank→bank)
ALTER TABLE public.bank_transfers ADD COLUMN IF NOT EXISTS funding_status         TEXT;  -- collection status (bank→bank)
ALTER TABLE public.bank_transfers ADD COLUMN IF NOT EXISTS failover_from          TEXT;  -- provider we failed over from, if any

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_transfers_source_type_check') THEN
    ALTER TABLE public.bank_transfers ADD CONSTRAINT bank_transfers_source_type_check
      CHECK (source_type IN ('wallet','bank'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_transfers_provider_check') THEN
    ALTER TABLE public.bank_transfers ADD CONSTRAINT bank_transfers_provider_check
      CHECK (provider IN ('paystack','monnify'));
  END IF;
END $$;

-- Widen the status set with the bank→bank funding states (additive value-set widen).
ALTER TABLE public.bank_transfers DROP CONSTRAINT IF EXISTS bank_transfers_status_check;
ALTER TABLE public.bank_transfers ADD CONSTRAINT bank_transfers_status_check
  CHECK (status IN (
    'funds_reserved',     -- wallet→bank: user wallet debited, awaiting provider
    'awaiting_funding',   -- bank→bank: collection initiated, awaiting pay-in
    'funded',             -- bank→bank: pay-in received into clearing
    'provider_initiated', -- payout accepted by the provider
    'successful',         -- transfer.success webhook
    'failed',             -- transfer.failed; funds reversed
    'reversed'            -- manual / admin reversal
  ));
CREATE INDEX IF NOT EXISTS bank_transfers_provider_idx ON public.bank_transfers (provider, status);
CREATE INDEX IF NOT EXISTS bank_transfers_provider_ref_idx ON public.bank_transfers (provider_transfer_ref) WHERE provider_transfer_ref IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) bank_transfer_recipients — generalize beyond Paystack.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.bank_transfer_recipients ALTER COLUMN paystack_recipient_code DROP NOT NULL;
ALTER TABLE public.bank_transfer_recipients ADD COLUMN IF NOT EXISTS provider               TEXT NOT NULL DEFAULT 'paystack';
ALTER TABLE public.bank_transfer_recipients ADD COLUMN IF NOT EXISTS provider_recipient_code TEXT;
-- One cached recipient code per (user, provider, bank, account).
CREATE UNIQUE INDEX IF NOT EXISTS bank_transfer_recipients_provider_uniq
  ON public.bank_transfer_recipients (user_id, provider, bank_code, account_number);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) user_transaction_pin — second factor for money movement (salted hash).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_transaction_pin (
  user_id        UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_hash       TEXT        NOT NULL,            -- bcrypt/argon2 hash; never the raw PIN
  failed_attempts INT        NOT NULL DEFAULT 0,
  locked_until   TIMESTAMPTZ,
  set_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_transaction_pin ENABLE ROW LEVEL SECURITY;
-- No authenticated policy → service_role (Go) only. The hash is never client-readable.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) payment_banks — bank reference list backing the picker / ListBanks fallback.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_banks (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT        NOT NULL UNIQUE,         -- NIP/NUBAN bank code
  name       TEXT        NOT NULL,
  slug       TEXT,
  active     BOOLEAN     NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_banks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_banks_read ON public.payment_banks;
CREATE POLICY payment_banks_read ON public.payment_banks FOR SELECT TO anon, authenticated USING (active = true);

DROP TRIGGER IF EXISTS trg_payment_banks_updated ON public.payment_banks;
CREATE TRIGGER trg_payment_banks_updated BEFORE UPDATE ON public.payment_banks FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_user_txn_pin_updated ON public.user_transaction_pin;
CREATE TRIGGER trg_user_txn_pin_updated BEFORE UPDATE ON public.user_transaction_pin FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Seed common Nigerian banks (display/fallback; provider ListBanks is authoritative
-- at runtime). Codes are standard NIP/NUBAN bank codes.
INSERT INTO public.payment_banks (code, name, slug) VALUES
  ('044','Access Bank','access-bank'),
  ('023','Citibank Nigeria','citibank-nigeria'),
  ('050','Ecobank Nigeria','ecobank-nigeria'),
  ('070','Fidelity Bank','fidelity-bank'),
  ('011','First Bank of Nigeria','first-bank-of-nigeria'),
  ('214','First City Monument Bank','fcmb'),
  ('058','Guaranty Trust Bank','gtbank'),
  ('030','Heritage Bank','heritage-bank'),
  ('301','Jaiz Bank','jaiz-bank'),
  ('082','Keystone Bank','keystone-bank'),
  ('50211','Kuda Bank','kuda-bank'),
  ('999992','OPay','opay'),
  ('999991','PalmPay','palmpay'),
  ('076','Polaris Bank','polaris-bank'),
  ('101','Providus Bank','providus-bank'),
  ('221','Stanbic IBTC Bank','stanbic-ibtc'),
  ('068','Standard Chartered','standard-chartered'),
  ('232','Sterling Bank','sterling-bank'),
  ('100','Suntrust Bank','suntrust-bank'),
  ('032','Union Bank of Nigeria','union-bank'),
  ('033','United Bank for Africa','uba'),
  ('215','Unity Bank','unity-bank'),
  ('035','Wema Bank','wema-bank'),
  ('057','Zenith Bank','zenith-bank')
ON CONFLICT (code) DO NOTHING;

COMMIT;
