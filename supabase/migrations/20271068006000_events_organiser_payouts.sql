-- EVTC-D003 (S1): organiser payout / settlement rail for ticket-sale escrow.
-- Additive only — one new table, no change to any existing table or row.
--
-- A payout disburses an event's eligible ticket proceeds (PAID orders, net of
-- refunded and disputed orders, the event's fee_bps platform fee and a
-- configurable reserve) from the shared `escrow` standing account to the
-- organiser's Paymax wallet (and the fee to `paymax_revenue`). Bank withdrawal
-- from that wallet then runs through the existing finance/transfers rail.
--
-- Money columns are BIGINT kobo. The row is the payout STATE MACHINE only; the
-- money itself lives in ledger_entries under the keys
--   evpayout:<id>:net:{debit,credit}   escrow -> organiser wallet
--   evpayout:<id>:fee:{debit,credit}   escrow -> paymax_revenue
-- which are unique, so a re-drive of the same payout can never post twice.
--
-- State machine (go-common/fsm table in top5events/payouts.go):
--   pending -> processing -> paid | failed ;  pending -> failed (checker reject)
-- Gated by FEATURE_EVENTS_ORGANISER_PAYOUTS (default off).

CREATE TABLE IF NOT EXISTS public.event_organiser_payouts (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                 uuid        NOT NULL REFERENCES public.events(id),
  organiser_id             uuid        NOT NULL,
  status                   text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','processing','paid','failed')),
  -- Incremental amounts covered by THIS payout (cumulative accounting: each new
  -- payout pays the eligible total minus every non-failed earlier payout).
  gross_kobo               bigint      NOT NULL CHECK (gross_kobo >= 0),
  fee_bps                  int         NOT NULL CHECK (fee_bps >= 0 AND fee_bps <= 10000),
  fee_kobo                 bigint      NOT NULL CHECK (fee_kobo >= 0),
  net_kobo                 bigint      NOT NULL CHECK (net_kobo >= 0),
  -- Reserve still held in escrow for the event AFTER this payout (cumulative).
  reserve_held_kobo        bigint      NOT NULL DEFAULT 0 CHECK (reserve_held_kobo >= 0),
  reserve_bps              int         NOT NULL DEFAULT 0 CHECK (reserve_bps >= 0 AND reserve_bps <= 10000),
  -- Statement snapshot at request time (informational).
  refunds_kobo             bigint      NOT NULL DEFAULT 0 CHECK (refunds_kobo >= 0),
  disputed_kobo            bigint      NOT NULL DEFAULT 0 CHECK (disputed_kobo >= 0),
  destination              text        NOT NULL DEFAULT 'wallet' CHECK (destination IN ('wallet')),
  idempotency_key          text        NOT NULL,
  requested_by             uuid        NOT NULL,
  approved_by              uuid,
  approval_idempotency_key text,
  failure_reason           text,
  ledger_reference         text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  processing_at            timestamptz,
  paid_at                  timestamptz,
  failed_at                timestamptz,
  CHECK (fee_kobo + net_kobo > 0)
);

-- One payout object per request key (create replays return the same row).
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_organiser_payouts_idem
  ON public.event_organiser_payouts (idempotency_key);
-- At most ONE in-flight payout per event: two concurrent triggers cannot both
-- create a payable row for the same proceeds.
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_organiser_payouts_inflight
  ON public.event_organiser_payouts (event_id) WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS idx_event_organiser_payouts_organiser
  ON public.event_organiser_payouts (organiser_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_organiser_payouts_status
  ON public.event_organiser_payouts (status, created_at);

-- RLS: the Go backend (service role / direct pgx) is the only writer. An
-- organiser may read only their own payouts (per-merchant segregation).
ALTER TABLE public.event_organiser_payouts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'event_organiser_payouts'
       AND policyname = 'event_organiser_payouts_select_own'
  ) THEN
    CREATE POLICY event_organiser_payouts_select_own ON public.event_organiser_payouts
      FOR SELECT USING (auth.uid() = organiser_id);
  END IF;
END $$;
