-- =============================================================================
-- Mobility card-direct — PARTIAL (piece) refunds for a charge that funds several
-- settlements (car hire: ONE card charge = fare + deposit). See
-- docs/adr/ADR-PRTBD-mobility-card-direct.md, "Partial refunds (car hire)".
--
-- Additive-only and idempotent (every statement is IF NOT EXISTS / guarded), and
-- safe on a database that already applied 20271008090000_transport_paystack_intents.sql
-- as shipped in 90a8e7bcd. That migration is NOT edited: this file carries the delta.
--
--   * transport_paystack_intents.refund_reserved_kobo / refunded_kobo + a CHECK
--     making "sum of refunds <= amount collected" a DATABASE invariant;
--   * transport_paystack_intent_refunds: one row per refunded settlement (piece),
--     fenced (claim_gen), at most ONE in flight per intent (partial unique index);
--   * post_attempted_at: stamped BEFORE the gateway refund POST. An ambiguous POST
--     followed by an empty gateway lookup cannot be told apart from a refund the
--     gateway has not listed YET, so another POST is only allowed once this
--     timestamp is older than the configured lag bound.
-- =============================================================================

BEGIN;

ALTER TABLE public.transport_paystack_intents
  ADD COLUMN IF NOT EXISTS refund_reserved_kobo bigint NOT NULL DEFAULT 0,  -- in-flight + done piece refunds
  ADD COLUMN IF NOT EXISTS refunded_kobo        bigint NOT NULL DEFAULT 0;  -- done piece refunds

CREATE TABLE IF NOT EXISTS public.transport_paystack_intent_refunds (
  reference         text   NOT NULL REFERENCES public.transport_paystack_intents(reference),
  refund_key        text   NOT NULL,                 -- the settlement id (stable, caller-derived)
  settlement_id     text   NOT NULL,
  amount_kobo       bigint NOT NULL CHECK (amount_kobo > 0),
  status            text   NOT NULL CHECK (status IN ('refunding','refunded','failed')),
  gateway_refund_id text,                            -- the gateway's id for this refund once known
  claim_gen         bigint NOT NULL DEFAULT 0,       -- per-row FENCE (same contract as the intent's)
  claimed_at        timestamptz,
  attempts          int    NOT NULL DEFAULT 1,
  post_attempted_at timestamptz,                     -- last time a gateway refund POST was STARTED (recorded before the call)
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  PRIMARY KEY (reference, refund_key)
);

-- A table created by an earlier build of this feature lacks the column.
ALTER TABLE public.transport_paystack_intent_refunds
  ADD COLUMN IF NOT EXISTS post_attempted_at timestamptz;

-- At most ONE piece refund in flight per intent: makes the gateway arithmetic
-- unambiguous (accepted-at-gateway minus recorded-refunded is 0 or this piece).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tpi_refunds_one_inflight
  ON public.transport_paystack_intent_refunds (reference) WHERE status = 'refunding';

CREATE INDEX IF NOT EXISTS idx_tpi_refunds_sweep
  ON public.transport_paystack_intent_refunds (status, claimed_at) WHERE status = 'refunding';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transport_paystack_intents_refund_cap') THEN
    ALTER TABLE public.transport_paystack_intents
      ADD CONSTRAINT transport_paystack_intents_refund_cap
      CHECK (refunded_kobo >= 0 AND refunded_kobo <= refund_reserved_kobo AND refund_reserved_kobo <= amount_kobo);
  END IF;
END $$;

-- RLS: backend-only (service_role bypasses); no anon/authenticated access.
DO $rls$
BEGIN
  IF to_regclass('public.transport_paystack_intent_refunds') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.transport_paystack_intent_refunds ENABLE ROW LEVEL SECURITY';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.transport_paystack_intent_refunds FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL ON public.transport_paystack_intent_refunds FROM authenticated';
    END IF;
  END IF;
END $rls$;

COMMIT;
