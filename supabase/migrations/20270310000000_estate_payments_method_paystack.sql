-- estate_payments.method — add 'paystack' to the allowed set.
-- Additive-only — no DROP of data, no RENAME, no type narrowing. Widens a
-- CHECK constraint only, via the established drop+recreate idiom (Postgres
-- has no ALTER CHECK to add a value) — see
-- 20261208000100_checkout_topup_purpose.sql for the identical precedent.
--
-- A Paystack-funded (no-wallet, no-KYC-tier-gate) dues payment
-- (estate/paystackcheckout) needs its own receipt.method value distinct from
-- the existing 'wallet' / 'card' / 'transfer' / 'ussd' set (none of which are
-- actually wired to a real distinct rail today).

ALTER TABLE estate_payments DROP CONSTRAINT IF EXISTS estate_payments_method_check;
ALTER TABLE estate_payments
    ADD CONSTRAINT estate_payments_method_check
    CHECK (method = ANY (ARRAY['wallet'::text, 'card'::text, 'transfer'::text, 'ussd'::text, 'paystack'::text]));
