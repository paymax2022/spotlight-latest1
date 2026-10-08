-- =============================================================================
-- Open Mic paid votes — Paystack charge intents (AUD-FE-003 residual / AUD-FE-009).
-- Additive-only. Thin reference→(contest, entry, voter, votes, amount) mapping
-- written by POST /api/open-mic/votes/pay/initiate. It freezes the server-side
-- quoted price (vote_price_ngn × votes) at charge time so that:
--   (a) the verify route reconciles the Paystack-confirmed amount against the
--       quote instead of trusting a client-declared votePriceNgn, and
--   (b) the webhook gateway handler / POST /api/v1/payments/gateway/recover
--       can fulfil a verified charge whose client never called verify —
--       previously the cast params lived only in the client's verify body.
--
-- Mirrors public.restaurant_order_paystack_intents (20270306000000) — same
-- thin-mapping shape. Stores NO money state: competition_entry_votes keyed by
-- payment_reference remains the dedup anchor and source of truth for votes.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.openmic_vote_paystack_intents (
  reference       text PRIMARY KEY,             -- om-vote-<uuid> minted at initiate
  contest_id      text NOT NULL,
  submission_id   text NOT NULL,                -- competition_entries.id
  voter_user_id   text NOT NULL,                -- auth.users.id (string)
  votes           integer NOT NULL CHECK (votes > 0),
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  stage_name      text,
  status          text NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now(),
  confirmed_at    timestamptz,
  failure_reason  text
);

ALTER TABLE public.openmic_vote_paystack_intents
  ADD CONSTRAINT openmic_vote_paystack_intents_status_check
  CHECK (status IN ('pending', 'confirmed', 'amount_mismatch', 'failed'));

COMMENT ON TABLE public.openmic_vote_paystack_intents IS
  'Reference-keyed pending record for Open Mic paid-vote charges. Written at '
  'initiate so verify/webhook/recover can settle a charge whose client '
  'callback never arrived. Votes are anchored by competition_entry_votes.'
  '.payment_reference; this table stores no money state.';

-- Service-role only: webhook/recover/verify run through createAdminClient.
ALTER TABLE public.openmic_vote_paystack_intents ENABLE ROW LEVEL SECURITY;

COMMIT;
