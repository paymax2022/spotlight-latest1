-- =============================================================================
-- Parcel: email the receiver their drop-off PIN, to an address the sender gives
-- at booking (FEATURE_PARCEL_RECEIVER_PIN_NOTIFY). See ADR-PR860 (docs/adr/ADR-PR860-parcel-receiver-pin-email.md).
--
-- Additive only.
--   receiver_email         optional address the sender gives at booking
--   receiver_notified_via  channels the PIN reached the receiver through
--                          (email | push | sms); empty/NULL = none
-- The PIN itself is still stored nowhere new.
-- =============================================================================

BEGIN;

ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS receiver_email        text,
  ADD COLUMN IF NOT EXISTS receiver_notified_via text[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parcels_receiver_email_len_check') THEN
    ALTER TABLE public.parcels
      ADD CONSTRAINT parcels_receiver_email_len_check
      CHECK (receiver_email IS NULL OR char_length(receiver_email) BETWEEN 3 AND 254);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parcels_receiver_notified_via_check') THEN
    ALTER TABLE public.parcels
      ADD CONSTRAINT parcels_receiver_notified_via_check
      CHECK (receiver_notified_via IS NULL OR receiver_notified_via <@ ARRAY['email','push','sms']::text[]);
  END IF;
END $$;

COMMIT;
