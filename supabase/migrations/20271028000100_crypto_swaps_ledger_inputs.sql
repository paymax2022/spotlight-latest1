-- crypto_swaps: the ledger inputs fixed at quote time (ADR-PR709).
--
-- ADDITIVE-ONLY. Safe to re-run. All new columns have defaults, so existing rows stay valid.
--   side      buy (NGN->crypto) | sell (crypto->NGN) | swap (crypto->crypto, no NGN leg).
--             Default 'swap' means "no NGN legs"; the buy pipeline MUST set side explicitly
--             (the settler refuses a side it does not know rather than skipping money).
--   ngn_kobo  integer kobo: buy = NGN principal paid, sell = quoted gross proceeds.
--   fee_bps   the markup resolved at quote time, so a later schedule change never reprices.
--   fee_kobo  buy: platform fee charged on top of ngn_kobo (floor(ngn_kobo * fee_bps / 10000)).

ALTER TABLE public.crypto_swaps
  ADD COLUMN IF NOT EXISTS side     TEXT   NOT NULL DEFAULT 'swap',
  ADD COLUMN IF NOT EXISTS ngn_kobo BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_bps  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_kobo BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crypto_swaps_ledger_inputs_check') THEN
    ALTER TABLE public.crypto_swaps ADD CONSTRAINT crypto_swaps_ledger_inputs_check CHECK (
      side IN ('buy','sell','swap')
      AND ngn_kobo >= 0 AND fee_kobo >= 0 AND fee_kobo <= ngn_kobo
      AND fee_bps BETWEEN 0 AND 10000
      AND (side = 'swap' OR ngn_kobo > 0)
    );
  END IF;
END $$;
