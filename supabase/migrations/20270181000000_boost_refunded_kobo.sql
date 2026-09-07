-- Additive-only: records the ACTUAL amount refunded on a boost. Until now every
-- refund was a full refund (RejectBoost, admin policy violation) so the client
-- could safely assume "priceKobo was refunded" — CancelBoost (seller-initiated,
-- prorated for the unused days) breaks that assumption, so the real amount
-- needs its own column rather than being re-derived from price_kobo.
ALTER TABLE public.mkt_boosts ADD COLUMN IF NOT EXISTS refunded_kobo BIGINT;
