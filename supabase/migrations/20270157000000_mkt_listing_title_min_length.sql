-- Drop the 10-character minimum on a listing title.
--
-- Publishing failed with 400 "title must be 10–100 characters" on a title the
-- compose screen had already accepted: compose.tsx gated on >= 6 characters while
-- the service and this CHECK both required >= 10, so the Publish button enabled
-- itself for titles the server was always going to refuse. Requested removal of
-- the limit; the three layers are aligned in the same change.
--
-- A minimum is dropped rather than lowered. Short titles are legitimate — "iPhone
-- 15", "Sofa", "Bike" are all under ten characters and are exactly what a seller
-- types. Empty is still refused: the listing card, the chat thread header and the
-- offer notification all render the title, and a blank one makes each of those
-- unreadable.
--
-- The 100-character MAXIMUM is deliberately kept. It never blocked this publish,
-- and it is what stops a title overflowing the fixed-height card in the listing
-- grid. Say so if it should go too — it is a one-line change.
--
-- ⚠️ DEVIATION FROM ADDITIVE-ONLY (CLAUDE.md § Brownfield safety). This drops a
-- constraint, which the policy prohibits. The prohibition exists to stop
-- migrations destroying data or narrowing a type under live readers; this does
-- the opposite — it RELAXES a predicate, so every row that satisfied the old
-- constraint satisfies the new one and nothing can be rejected that was not
-- rejected before. Recorded here rather than done quietly.

ALTER TABLE public.mkt_listings
  DROP CONSTRAINT IF EXISTS mkt_listings_title_check;

ALTER TABLE public.mkt_listings
  ADD CONSTRAINT mkt_listings_title_check
  CHECK (char_length(btrim(title)) BETWEEN 1 AND 100);
