-- Paymax Health — widen the credential-vault doc-type CHECK so the Mode-B VCN
-- evidence-doc vocabulary the credential service writes is storable.
-- ADDITIVE-ONLY: no existing value removed (same pattern as
-- 20260815000600_doctor_mdcn_assisted_verification.sql).
-- Widened rather than remapped because SetLicenceExpiryOnDoc writes
-- WHERE cred_type='ANNUAL_LICENCE' and the doc-access log audits cred_type —
-- collapsing onto issuer names would break both.
BEGIN;

-- pharmacy_products.category safety net: the Go INSERT now writes the column;
-- ensure it exists on databases that ran pharmacy without the premium migration.
ALTER TABLE public.pharmacy_products
  ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE public.health_credential_docs
  DROP CONSTRAINT IF EXISTS health_credential_docs_cred_type_check;
ALTER TABLE public.health_credential_docs
  ADD CONSTRAINT health_credential_docs_cred_type_check
  CHECK (cred_type IN ('VCN','PCN','MLSCN','NAFDAC','PREMISES','OTHER',
                       'VCN_CERT','ANNUAL_LICENCE','GOV_ID'));

COMMIT;
