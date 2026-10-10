-- Marketplace saved searches: persist the alert frequency the app already offers.
--
-- The mobile "Saved searches" screen lets a user pick Instant / Daily / Off, but
-- mkt_saved_searches only had a boolean alert_enabled, so the PATCH dropped the
-- frequency and "Daily" snapped back to "Instant" after every refresh.
--
-- Additive only: one new column with a safe default. Existing rows are backfilled
-- from alert_enabled so an alert a user had switched off stays off.
ALTER TABLE public.mkt_saved_searches
  ADD COLUMN IF NOT EXISTS alert_frequency TEXT NOT NULL DEFAULT 'instant';

DO $$ BEGIN
  ALTER TABLE public.mkt_saved_searches
    ADD CONSTRAINT mkt_saved_searches_alert_frequency_chk
    CHECK (alert_frequency IN ('instant', 'daily', 'off'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

UPDATE public.mkt_saved_searches
   SET alert_frequency = 'off'
 WHERE alert_enabled = false AND alert_frequency <> 'off';
