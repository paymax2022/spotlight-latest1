-- =============================================================================
-- Parcel: tell the receiver their drop-off PIN by SMS (FEATURE_PARCEL_RECEIVER_PIN_SMS).
-- See ADR-PR857 (docs/adr/ADR-PR857-parcel-receiver-dropoff-pin-sms.md).
--
-- Additive only. The two columns make the send at-most-once and visible:
--   receiver_pin_notice  NULL (never attempted) | sending (claimed) | sent | failed
--   receiver_notified_at when the SMS was accepted by the provider (sent only)
-- The PIN itself is never stored anywhere new: it is read from parcels.dropoff_pin
-- at send time.
-- =============================================================================

BEGIN;

ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS receiver_pin_notice  text,
  ADD COLUMN IF NOT EXISTS receiver_notified_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parcels_receiver_pin_notice_check') THEN
    ALTER TABLE public.parcels
      ADD CONSTRAINT parcels_receiver_pin_notice_check
      CHECK (receiver_pin_notice IS NULL OR receiver_pin_notice IN ('sending', 'sent', 'failed'));
  END IF;
END $$;

COMMIT;
