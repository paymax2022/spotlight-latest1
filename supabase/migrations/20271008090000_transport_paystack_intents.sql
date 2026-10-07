-- =============================================================================
-- Mobility card-direct (ADR-PRTBD-mobility-card-direct) — generic Paystack-funded
-- intents shared by every non-ride Mobility service (parcel first; bus, towing,
-- car-hire, movers, event transport plug in later with NO schema change: a new
-- service is just a new `domain` value + reference prefix).
--
-- Additive-only. The ride table (transport_ride_paystack_intents) is untouched.
-- Same thin-mapping discipline as restaurant_order_paystack_intents: this row
-- stores NO money state — the ledger (settlement.EscrowExternal) and the entity
-- tables stay the source of truth for anything that moved. It only
--   (a) makes initiate idempotent on (domain, Idempotency-Key),
--   (b) freezes the exact server-quoted amount + request the customer paid for,
--   (c) lets confirm/webhook/status resolve a gateway reference back to it, and
--   (d) records the claim time + a monotonically increasing fence (claim_gen) so
--       a crashed confirmation can be taken over AND a stalled former owner can
--       never overwrite the new owner's (or a terminal) state, and
--   (e) records the in-flight gateway refund ('refunding') BEFORE the gateway is
--       called so an ambiguous gateway reply is resolved by lookup, never by guess.
--
-- NOTE: this file has not shipped; it is edited in place (no ALTER of a released
-- object). Any DB that already applied the first draft needs the table dropped
-- and the file replayed (local/throwaway only).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.transport_paystack_intents (
  reference         text PRIMARY KEY,                 -- '<domain prefix>:<idempotency key>', e.g. 'parcelorder:...'
  domain            text NOT NULL,                    -- 'parcel' | 'bus' | 'towing' | ...
  payer_id          text NOT NULL,
  request_json      jsonb NOT NULL,                   -- frozen client request (email/callback stripped)
  amount_kobo       bigint NOT NULL,                  -- frozen server quote
  idempotency_key   text NOT NULL,
  status            text NOT NULL DEFAULT 'pending',  -- pending | processing | confirmed | amount_mismatch | order_failed | refunding | refunded
  entity_id         text,                             -- booked entity (parcel id, ...) once confirmed
  authorization_url text,                             -- stored so a replayed initiate never re-initializes the gateway
  access_code       text,
  refund_reference  text,
  claimed_at        timestamptz,                      -- last claim / refund-start time (stale takeover clock)
  claim_gen         bigint NOT NULL DEFAULT 0,        -- FENCE: bumped by every claim/takeover; every state write is conditional on it
  pricing_json      jsonb,                            -- frozen priced inputs (route distance/duration + pricing-config snapshot) so confirm re-prices from what was quoted
  refund_from       text,                             -- status to restore if the gateway DEFINITELY did not refund (amount_mismatch | order_failed | confirmed)
  refund_amount_kobo bigint,                          -- exact amount the gateway refund was issued for (collected amount on a mismatch)
  created_at        timestamptz NOT NULL DEFAULT now(),
  confirmed_at      timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_transport_paystack_intents_domain_key
  ON public.transport_paystack_intents (domain, idempotency_key);

-- One intent per booked entity: the cancel/refund path resolves intent BY entity,
-- so two intents pointing at one entity would let a refund hit the wrong charge.
CREATE UNIQUE INDEX IF NOT EXISTS uq_transport_paystack_intents_domain_entity
  ON public.transport_paystack_intents (domain, entity_id) WHERE entity_id IS NOT NULL;

-- One OPEN checkout per mover job (ledger-audit round 2, M3). A move is charged at
-- bid acceptance, so two live intents for one job could both be paid: two charges,
-- one move, one of them refunded. Partial (non-terminal statuses only) so a
-- confirmed / refunded intent never blocks a later, legitimate checkout. The
-- expression is the job_id of the frozen request_json (movers carry {job_id,bid_id}).
CREATE UNIQUE INDEX IF NOT EXISTS uq_transport_paystack_intents_mover_open_job
  ON public.transport_paystack_intents ((request_json->>'job_id'))
  WHERE domain = 'movers' AND status IN ('pending','processing');

-- Reconciliation sweeper scan (status + age).
CREATE INDEX IF NOT EXISTS idx_transport_paystack_intents_sweep
  ON public.transport_paystack_intents (status, created_at)
  WHERE status IN ('pending','processing','refunding','amount_mismatch','order_failed');

CREATE INDEX IF NOT EXISTS idx_transport_paystack_intents_payer
  ON public.transport_paystack_intents (payer_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transport_paystack_intents_status_check') THEN
    ALTER TABLE public.transport_paystack_intents
      ADD CONSTRAINT transport_paystack_intents_status_check
      CHECK (status IN ('pending','processing','confirmed','amount_mismatch','order_failed','refunding','refunded'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transport_paystack_intents_amount_positive') THEN
    ALTER TABLE public.transport_paystack_intents
      ADD CONSTRAINT transport_paystack_intents_amount_positive CHECK (amount_kobo > 0);
  END IF;
END $$;

-- RLS: backend-only (service_role bypasses); no anon/authenticated access.
DO $rls$
BEGIN
  IF to_regclass('public.transport_paystack_intents') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.transport_paystack_intents ENABLE ROW LEVEL SECURITY';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.transport_paystack_intents FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL ON public.transport_paystack_intents FROM authenticated';
    END IF;
  END IF;
END $rls$;

COMMIT;
