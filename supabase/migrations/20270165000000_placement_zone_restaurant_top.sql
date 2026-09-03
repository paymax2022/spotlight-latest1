-- Paid "feature my restaurant" placement: a zone for the restaurant list itself.
--
-- WHY A NEW ZONE
-- The featured-placement module already does everything this needs — draft,
-- quote, review, pay, activate, expire, pause, analytics — but its three zones
-- (HERO, SPOTLIGHT_CAROUSEL, FEATURED_GRID) all promote onto the app LANDING
-- page. A restaurant owner wanting to sit above other restaurants in the food
-- discovery list has no surface to buy, so this adds one rather than
-- overloading a landing zone to mean two different places.
--
-- POOLED, not EXCLUSIVE: several restaurants can be featured at once and are
-- ordered among themselves by the discovery sort. Selling the top of a listing
-- to exactly one merchant makes the slot near-unbuyable and the page static.
--
-- ⚠️ MONEY: base_daily_rate_kobo is KOBO, like every other zone. 150000 = ₦1,500
-- per day. Priced below FEATURED_GRID (₦3,000) because this promotes within one
-- category's list rather than the whole app's landing page. The quote is
-- base_daily_rate_kobo × duration_days × tier_multiplier, computed by the
-- placement module — nothing here prices anything on its own.

INSERT INTO public.placement_zone
  (code, label, layout_type, capacity, base_daily_rate_kobo, tier_multiplier, position, is_active, creative_spec, rate_version)
VALUES (
  'RESTAURANT_TOP',
  'Top of Restaurants',
  'POOLED',
  6,
  150000,
  1.000,
  3,
  true,
  -- The discovery card renders the restaurant's own logo and name, so the
  -- creative is a short headline only. Ratio matches the existing card art.
  '{"cta_options": ["Order now", "View menu"], "image_ratio": "1:1", "headline_max": 24}'::jsonb,
  1
)
ON CONFLICT (code) DO NOTHING;

-- Discovery orders every page by "is this restaurant featured right now", which
-- is a correlated lookup per row. This index makes that a cheap index probe
-- instead of a scan of every campaign the platform has ever sold.
--
-- Column order matches the lookup: the constant predicates first, then the
-- subject the row is matched on, then the window bounds the planner filters by.
CREATE INDEX IF NOT EXISTS featured_campaign_serving_subject_idx
  ON public.featured_campaign (zone_code, state, subject_type, subject_id, window_start, window_end);

COMMENT ON INDEX public.featured_campaign_serving_subject_idx IS
  'Supports the per-restaurant "featured right now" test in food discovery ordering. See restaurant/discovery_page.go.';
