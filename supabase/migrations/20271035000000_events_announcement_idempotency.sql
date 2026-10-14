-- Events organiser Phase 3: idempotent announcements. ADDITIVE ONLY.
BEGIN;

ALTER TABLE public.event_announcements
  ADD COLUMN IF NOT EXISTS idempotency_key text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_announcements_idem
  ON public.event_announcements (event_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
