-- Mandatory convenience fee (paid by the user) on Cable TV and Electricity bills.
--
-- The utility payment engine debits the wallet for `retail_amount_kobo`, which
-- pricing.ts computes as: amount + markup + convenience_fee_kobo. The provider is
-- only paid the bill `amount_kobo`, so this flat fee is retained by Paymax as
-- gross profit (already reflected in gross_profit_kobo / reconciliation reports).
--
-- ₦100 = 10000 kobo. Data-only, additive, idempotent (safe to re-run).
UPDATE public.utility_products
SET convenience_fee_kobo = 10000,
    updated_at = now()
WHERE category IN ('electricity', 'cable_tv')
  AND convenience_fee_kobo <> 10000;
