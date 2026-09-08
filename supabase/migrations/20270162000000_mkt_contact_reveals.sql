-- Seller phone reveals: rate limiting, and a record of who saw what.
--
-- The listing screen had a "Tap to reveal seller phone" control that only
-- toggled local state and relabelled itself — no number was ever fetched,
-- because nothing in the stack had one to give. This table is what makes the
-- reveal both limited and accountable.
--
-- It exists for two reasons, and the second is the important one:
--
--   1. RATE LIMITING. Any signed-in user may reveal, so the only thing standing
--      between a scraper and every seller's phone number is a per-viewer budget.
--      The count is read from here rather than from Redis so the limit survives a
--      cache flush or a restart — a rate limit that forgets is not a rate limit.
--
--   2. ACCOUNTABILITY. A phone number is PII. When a seller reports harassment,
--      "who was given my number, and when" has to be answerable. That is the row
--      this table keeps, and it is why a repeat reveal of the SAME listing is
--      still recorded even though it does not spend budget.
--
-- No unique constraint on (viewer, listing) on purpose: the second look is a
-- separate event and belongs in the record.

CREATE TABLE IF NOT EXISTS public.mkt_contact_reveals (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid        NOT NULL REFERENCES public.mkt_listings(id) ON DELETE CASCADE,
  viewer_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id   uuid        NOT NULL,
  revealed_at timestamptz NOT NULL DEFAULT now()
);

-- The rate-limit read: "how many DISTINCT listings has this viewer revealed
-- since T". Ordered to serve that predicate directly.
CREATE INDEX IF NOT EXISTS idx_mkt_contact_reveals_viewer_time
  ON public.mkt_contact_reveals (viewer_id, revealed_at DESC);

-- The abuse-report read: "who has been given MY number".
CREATE INDEX IF NOT EXISTS idx_mkt_contact_reveals_seller_time
  ON public.mkt_contact_reveals (seller_id, revealed_at DESC);

COMMENT ON TABLE public.mkt_contact_reveals IS
  'One row per seller-phone reveal. Backs the per-viewer rate limit and answers '
  '"who was given this seller''s number, and when" for abuse reports.';

-- Server-only, like the rest of the marketplace write path: every read and write
-- goes through the Go service with the service-role client. No policy is granted,
-- so PostgREST exposes nothing — a viewer must not be able to query who else
-- revealed a number, and a seller's number must not be reachable by joining this
-- table from the client.
ALTER TABLE public.mkt_contact_reveals ENABLE ROW LEVEL SECURITY;
