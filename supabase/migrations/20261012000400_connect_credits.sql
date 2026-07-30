-- Paymax Connect — consumable credits (PAY-008: no double-spend, no negative)
-- Ref: Spotlight_Connect_Test_Plan TS-8 PAY-008.
--
-- Consumable credits (super-likes, InMail, boosts-as-count) were previously modelled
-- only as entitlement quota flags that were READ (>0) but never spent down, so they
-- were effectively unlimited. This adds a proper balance + append-only txn log:
--   • connect_credits      — one balance row per (user, credit_type), CHECK >= 0.
--   • connect_credit_txns  — idempotent grant/consume ledger; balance = Σ(delta).
-- Consumption decrements the balance with a `balance >= n` guard under the row lock,
-- so concurrent spends can neither double-spend nor drive the balance negative.
--
-- Additive-only: CREATE TABLE/INDEX IF NOT EXISTS. Nothing existing is modified.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.connect_credits (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credit_type text NOT NULL,
  balance     bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, credit_type)
);

CREATE TABLE IF NOT EXISTS public.connect_credit_txns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,   -- one grant/consume per key (dedup)
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credit_type     text NOT NULL,
  delta           bigint NOT NULL,        -- + grant / - consume
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connect_credit_txns_user_idx
  ON public.connect_credit_txns (user_id, credit_type, created_at DESC);

COMMIT;
