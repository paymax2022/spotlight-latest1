-- Migration: crossborder_onboarding (SP-2 Global Account onboarding)
-- Provider-agnostic sub-account / wallet / funding-detail / submission / consent
-- tables for the Spotlight Global (Verto) onboarding domain.
-- EXPAND-only (additive). No DROP, no renames, no type narrowing.
--   * No ledger_accounts / ledger_entries changes; no balances (SP-3).
--   * funding_details.account_number_enc holds AES-256-GCM ciphertext written by
--     the Go repository (internal/platform/crypto, KYC_PII_ENC_KEY) — never plaintext.
--   * RLS enabled; service_role (Go pgx) is the sole writer. Owners may SELECT
--     their own account rows only.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.provider_accounts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider            text        NOT NULL,
  subject_type        text        NOT NULL CHECK (subject_type IN ('individual','business')),
  provider_company_id text,
  status              text        NOT NULL DEFAULT 'NOT_STARTED'
                      CHECK (status IN ('NOT_STARTED','SUBMITTED','IN_REVIEW','AWAITING_TNC','ACTIVE','REJECTED','SUSPENDED')),
  prior_status        text,
  tier_at_activation  integer,
  rejection_reason    text,
  idempotency_key     text        NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  submitted_at        timestamptz,
  approved_at         timestamptz,
  tnc_accepted_at     timestamptz
);

-- One Global Account per user per provider while it is in flight or active
-- (a REJECTED account does not block a fresh resubmission).
CREATE UNIQUE INDEX IF NOT EXISTS provider_accounts_user_provider_live_uq
  ON public.provider_accounts (user_id, provider)
  WHERE status <> 'REJECTED';

CREATE UNIQUE INDEX IF NOT EXISTS provider_accounts_company_uq
  ON public.provider_accounts (provider, provider_company_id)
  WHERE provider_company_id IS NOT NULL;

ALTER TABLE public.provider_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_accounts_own ON public.provider_accounts;
CREATE POLICY provider_accounts_own ON public.provider_accounts FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.provider_wallets (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_account_id uuid       NOT NULL REFERENCES public.provider_accounts(id) ON DELETE CASCADE,
  currency           text        NOT NULL,
  provider_wallet_id text        NOT NULL,
  funding_mode       text,
  status             text        NOT NULL DEFAULT 'active',
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_account_id, currency)
);
ALTER TABLE public.provider_wallets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.funding_details (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id          uuid        NOT NULL REFERENCES public.provider_wallets(id) ON DELETE CASCADE,
  currency           text        NOT NULL DEFAULT '',
  rail               text        NOT NULL DEFAULT 'default',
  account_name       text        NOT NULL DEFAULT '',
  account_number_enc text        NOT NULL,          -- AES-256-GCM ciphertext (base64)
  bank_code          text        NOT NULL DEFAULT '',
  bank_name          text        NOT NULL DEFAULT '',
  reference_rule     text        NOT NULL DEFAULT '',
  smart_wallet_ref   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wallet_id, rail)
);
ALTER TABLE public.funding_details ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.onboarding_submissions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_account_id uuid        NOT NULL REFERENCES public.provider_accounts(id) ON DELETE CASCADE,
  version             integer     NOT NULL,
  payload_ref         text        NOT NULL DEFAULT '',   -- reference only; raw PII payload is not stored here
  documents_json      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  result              text        NOT NULL DEFAULT '',
  UNIQUE (provider_account_id, version)
);
ALTER TABLE public.onboarding_submissions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.onboarding_consents (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_account_id uuid        NOT NULL REFERENCES public.provider_accounts(id) ON DELETE CASCADE,
  document            text        NOT NULL DEFAULT 'tnc',
  tnc_version         text        NOT NULL,
  accepted_at         timestamptz NOT NULL,
  ip                  text        NOT NULL DEFAULT '',
  device              text        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS onboarding_consents_account_idx
  ON public.onboarding_consents (provider_account_id);
ALTER TABLE public.onboarding_consents ENABLE ROW LEVEL SECURITY;

-- Append-only consent log: rows can never be rewritten. (Deletion only occurs
-- through the owning account's cascade.)
CREATE OR REPLACE FUNCTION public.onboarding_consents_no_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'onboarding_consents is append-only';
END;
$$;
DROP TRIGGER IF EXISTS onboarding_consents_no_update ON public.onboarding_consents;
CREATE TRIGGER onboarding_consents_no_update
  BEFORE UPDATE ON public.onboarding_consents
  FOR EACH ROW EXECUTE FUNCTION public.onboarding_consents_no_update();

COMMIT;
