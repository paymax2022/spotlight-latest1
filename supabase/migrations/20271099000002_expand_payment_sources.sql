-- Migration: expand_payment_sources
-- Additive: expands the utility_transactions payment_source enum to include card and transfer payments

-- Expand the payment_source check constraint to include more payment methods
ALTER TABLE public.utility_transactions
  DROP CONSTRAINT utility_transactions_payment_source_check,
  ADD CONSTRAINT utility_transactions_payment_source_check
    CHECK (payment_source IN ('wallet', 'paystack', 'transfer', 'cash'));

-- Create a helper function to determine payment method from a commission earning record
-- This reads the source transaction to extract payment method info
CREATE OR REPLACE FUNCTION public.get_earning_payment_method(
  p_source_module TEXT,
  p_source_ref TEXT
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_payment_method TEXT := 'unknown';
BEGIN
  -- For utility bills: check utility_transactions.payment_source
  IF p_source_module = 'utility' OR p_source_module = 'bills' THEN
    SELECT COALESCE(payment_source, 'wallet')
    INTO v_payment_method
    FROM public.utility_transactions
    WHERE id::text = p_source_ref
    LIMIT 1;
  END IF;

  -- For restaurant orders: check orders.payment_method (if it exists)
  -- Fallback: return 'unknown' if module not supported yet

  RETURN COALESCE(v_payment_method, 'unknown');
END $$;

-- Create an index to speed up earning payment method lookups
CREATE INDEX IF NOT EXISTS idx_utility_transactions_id_payment_source
  ON public.utility_transactions(id, payment_source);
