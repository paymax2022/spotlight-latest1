-- Insurance — provider float state (prefunded distributor wallet circuit breaker).
--
-- ⛔ WHY THIS EXISTS
-- MyCover does NOT charge per transaction. Paymax holds a PREFUNDED DISTRIBUTOR
-- WALLET with MyCover, and every policy purchase debits that float. Verified
-- live: a purchase payload in which every field was accepted still failed with
--   {"responseCode":0,"responseText":"v2 Error: Insufficient wallet fund for purchase"}
--
-- The failure mode this guards against is not a rare edge case, it is a cliff:
-- when the float empties, EVERY bind fails at once. The premium debit happens
-- BEFORE the provider bind in the bind saga, so without a brake, an empty float
-- means every member in the queue is debited and reversed, one after another.
-- One such reversal is a correct saga; a thousand is an incident.
--
-- So the first bind that hits an empty float TRIPS this breaker, and every
-- subsequent bind is refused BEFORE the member's money moves. An operator tops
-- up the MyCover wallet and resets the breaker.
--
-- This table records STATE ABOUT the float. It is NOT a balance and NOT a
-- ledger: no member money is represented here, nothing is posted against it, and
-- it must never be treated as an account. Paymax's own money stays in
-- ledger_entries where it belongs.
--
-- We cannot read the true balance: /wallet/balance and /wallet/transactions
-- return 403 "Forbidden resource" for our key, so the balance is funded and read
-- from the MyCover dashboard. The breaker therefore records what we OBSERVED
-- (the provider refused a purchase), never a figure we invented.
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX/POLICY IF NOT EXISTS.

BEGIN;

CREATE TABLE IF NOT EXISTS public.insurance_provider_float (
  provider              text PRIMARY KEY,          -- mycover | octamile
  -- ok        : no float refusal observed; binds proceed.
  -- exhausted : the provider refused a purchase for want of float; binds are
  --             refused BEFORE any member debit until an operator resets.
  -- unknown   : never exercised.
  state                 text NOT NULL DEFAULT 'unknown'
                          CHECK (state IN ('ok','exhausted','unknown')),
  -- Count of consecutive float refusals; resets on a successful bind.
  consecutive_failures  int NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_failure_at       timestamptz,
  last_success_at       timestamptz,
  -- Provider's own message, verbatim. Provider-side text only — never a key and
  -- never member PII.
  last_failure_text     text,
  -- Operator-recorded top-up. This is a NOTE for the humans, not an authority:
  -- the real balance lives at MyCover and we cannot read it.
  last_topup_note       text,
  last_reset_at         timestamptz,
  last_reset_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insurance_provider_float_state
  ON public.insurance_provider_float (state);

ALTER TABLE public.insurance_provider_float ENABLE ROW LEVEL SECURITY;

-- Operational data: admins read it, the engine writes it via service-role (which
-- bypasses RLS). No member-facing policy.
DROP POLICY IF EXISTS insurance_provider_float_admin_read ON public.insurance_provider_float;
CREATE POLICY insurance_provider_float_admin_read
  ON public.insurance_provider_float
  FOR SELECT
  USING (public.is_admin());

-- Seed the known aggregators in 'unknown' so admin shows a row from day one
-- rather than an empty screen that reads like "everything is fine".
INSERT INTO public.insurance_provider_float (provider, state)
VALUES ('mycover','unknown'), ('octamile','unknown')
ON CONFLICT (provider) DO NOTHING;

COMMIT;
