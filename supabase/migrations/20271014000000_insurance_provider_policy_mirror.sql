-- Insurance: read-only mirror of the policies the PROVIDER (MyCover) holds for us.
--
-- ADDITIVE-ONLY: one new table, nothing existing touched.
--
-- Why a separate table and not insurance_policy: insurance_policy is Paymax's own
-- book. It requires a Paymax policyholder (policyholder_user_id NOT NULL) and the
-- dashboard's gross-premium and commission figures are built from it. A policy
-- bought directly at MyCover has no Paymax user and moved no money through our
-- ledger, so importing it there would put premium on the revenue KPIs that was
-- never ours. This table only answers "what does the provider hold" and is shown
-- next to the book, never summed into it.
--
-- No personal data: the provider's list rows carry the policyholder's name,
-- email, phone and date of birth. None of that is stored — only the policy,
-- product and money facts below.

CREATE TABLE IF NOT EXISTS public.insurance_provider_policy (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider             text NOT NULL,                        -- aggregator, e.g. 'mycover'
  provider_policy_ref  text NOT NULL,                        -- the provider's own policy id
  policy_number        text,
  provider_product_id  text,
  product_name         text NOT NULL DEFAULT '',
  underwriter          text NOT NULL DEFAULT '',
  status               text NOT NULL DEFAULT '',             -- active | expired | inactive | '' (unknown)
  premium_kobo         bigint NOT NULL DEFAULT 0 CHECK (premium_kobo >= 0),
  currency             text NOT NULL DEFAULT 'NGN',
  starts_at            timestamptz,
  expires_at           timestamptz,
  certificate_url      text,
  provider_created_at  timestamptz,
  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_policy_ref)
);

CREATE INDEX IF NOT EXISTS idx_insurance_provider_policy_seen
  ON public.insurance_provider_policy (provider, last_seen_at DESC);

-- Backend-only table: RLS on with no policies = no access through the public
-- API; the Go service connects with its own credentials.
ALTER TABLE public.insurance_provider_policy ENABLE ROW LEVEL SECURITY;
