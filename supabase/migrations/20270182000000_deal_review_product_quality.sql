-- Additive-only: a second sub-score on the existing thread-keyed deal review
-- (mkt_deal_reviews) — "rating" stays the overall/seller score, this is
-- specifically how the buyer rates the ITEM they transacted for. One review
-- flow, two numbers, per the product decision to extend the existing review
-- rather than build a separate listing-rating subsystem. No listing_id column
-- needed: a deal review is keyed to a thread, and mkt_threads.listing_id
-- already resolves it (thread ↔ listing is 1:1 by construction).
ALTER TABLE public.mkt_deal_reviews
  ADD COLUMN IF NOT EXISTS product_quality_rating SMALLINT CHECK (product_quality_rating BETWEEN 1 AND 5);
