-- Restaurant listing review (foodhub A6 / §6.3) — additive-only.
--
-- WHY
-- A restaurant's public face — name, description, address, menu — goes live the
-- instant the owner saves it. There is no review of any kind. For a consumer
-- marketplace that is a standing trust problem: nothing stands between an owner's
-- text and a customer's screen.
--
-- SAFETY — this migration must change NOTHING that customers see.
-- Every existing restaurant is backfilled APPROVED, so the discovery gate
-- (`listing_review_status = 'APPROVED'`) selects exactly the same rows as today.
-- The gate itself is additionally behind FEATURE_FOODHUB_MODERATION, which
-- defaults OFF, per PRD §1.4: "existing consumer flow must behave identically
-- with all new flags OFF".
--
-- New restaurants start DRAFT. With the flag OFF that is inert. With it ON, a new
-- shop must be reviewed before it appears — which is the point of the feature,
-- and the reason it ships dark.

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS listing_review_status TEXT NOT NULL DEFAULT 'DRAFT';

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS listing_review_reason TEXT;

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS listing_reviewed_by UUID REFERENCES auth.users(id);

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS listing_reviewed_at TIMESTAMPTZ;

-- The listing as approved. Kept so a reviewer's decision refers to a specific
-- text, not to whatever the owner has edited since — otherwise "approved" means
-- nothing the moment the owner changes the description.
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS published_snapshot JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurants_listing_review_status_check') THEN
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_listing_review_status_check
      CHECK (listing_review_status IN ('DRAFT','PENDING','APPROVED','CHANGES_REQUESTED','REJECTED'));
  END IF;
END $$;

-- Grandfather every existing restaurant. Anything already trading was, in
-- effect, already published; marking it DRAFT would hide 1651 live shops the
-- moment the flag is turned on.
UPDATE public.restaurants
   SET listing_review_status = 'APPROVED',
       listing_reviewed_at   = COALESCE(listing_reviewed_at, now())
 WHERE listing_review_status = 'DRAFT';

-- Discovery reads (is_open, listing_review_status) together once the flag is on.
CREATE INDEX IF NOT EXISTS restaurants_discovery_idx
  ON public.restaurants (is_open, listing_review_status);

COMMENT ON COLUMN public.restaurants.listing_review_status IS
  'Moderation state of the public listing (foodhub §6.3). Only APPROVED is discoverable, and only when FEATURE_FOODHUB_MODERATION is on.';
