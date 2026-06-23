-- Paymax Connect — Phase 0: verification-data store (no plaintext PII)
-- Ref: docs/prd/dating/compliance.md invariant 5 ("Verification data encrypted at
-- rest, retention defined, never logged") + acceptance.md §27 Phase 0.
--
-- This table backs the verification hooks in backend/internal/connect/verification
-- (hasher.go / redact.go / retention.go). It deliberately stores NO raw document
-- numbers, DOB, or biometric payloads — only:
--   * doc_hash      : HMAC-SHA256(pepper, docType:userID:docNumber) for dedup
--   * evidence_ref  : an opaque storage/provider reference (e.g. R2 object key);
--                     the binary itself lives in access-controlled object storage,
--                     never in a plaintext column here.
-- Retention is governed by connect_config (verification.retention_days); a purge
-- job clears expired evidence_ref values (the row + hash may be retained for
-- dedup/audit, but the pointer to the stored document is removed).
--
-- Additive-only: CREATE TABLE/INDEX IF NOT EXISTS, idempotent policies.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.connect_verification (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- L0 selfie/liveness, L1 doc, etc. Mirrors the verification ladder in product.md.
  level           text NOT NULL DEFAULT 'l0'
                    CHECK (level IN ('l0','l1','l2','l3')),
  doc_type        text,                       -- e.g. 'NIN','BVN','passport' (label only)
  -- Non-reversible HMAC of the identifier (NEVER the raw value). Unique per
  -- (doc_type, doc_hash) prevents the same document being verified twice across
  -- accounts (cross-account duplicate-identity abuse), matching the KYC pattern.
  doc_hash        text,
  -- Opaque pointer into access-controlled object storage (signed-URL only). Never
  -- a plaintext document. Cleared by the retention purge job.
  evidence_ref    text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','expired')),
  reviewed_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  evidence_purged_at timestamptz,             -- set when evidence_ref is purged
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connect_verification_user   ON public.connect_verification (user_id);
CREATE INDEX IF NOT EXISTS idx_connect_verification_status ON public.connect_verification (status, created_at DESC);
-- Dedup guard: a given document hash can be tied to at most one verification row
-- per doc_type. NULL doc_hash rows (e.g. pure selfie/liveness) are not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_connect_verification_dochash
  ON public.connect_verification (doc_type, doc_hash)
  WHERE doc_hash IS NOT NULL;

-- updated_at trigger (reuse generic helper).
DROP TRIGGER IF EXISTS trg_connect_verification_updated ON public.connect_verification;
CREATE TRIGGER trg_connect_verification_updated
  BEFORE UPDATE ON public.connect_verification
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS: the subject may read their OWN verification status (not evidence internals);
-- admins read all; only service_role writes (the backend hashes + stores). The
-- evidence_ref is a server-managed pointer and is not meant for direct client use.
ALTER TABLE public.connect_verification ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connect_verification_select_own ON public.connect_verification;
CREATE POLICY connect_verification_select_own ON public.connect_verification
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS connect_verification_service ON public.connect_verification;
CREATE POLICY connect_verification_service ON public.connect_verification
  TO service_role USING (TRUE) WITH CHECK (TRUE);

COMMIT;
