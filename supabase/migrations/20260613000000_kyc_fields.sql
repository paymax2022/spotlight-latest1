-- Migration: Add KYC fields to user_profiles
-- Block 2 — docs/build-playbook.md
-- Additive only: ADD COLUMN IF NOT EXISTS; no DROP, no RENAME, no type changes.

BEGIN;

-- KYC tier: 0=Unverified, 1=Basic, 2=Standard, 3=Premium
-- Gated features per tier documented in docs/prd.md § EPIC 2
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS kyc_tier     SMALLINT     NOT NULL DEFAULT 0
                                        CHECK (kyc_tier BETWEEN 0 AND 3),
  ADD COLUMN IF NOT EXISTS kyc_status   TEXT         NOT NULL DEFAULT 'unverified'
                                        CHECK (kyc_status IN ('unverified','pending','verified','failed','suspended')),
  ADD COLUMN IF NOT EXISTS kyc_submitted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_verified_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone_verified    BOOLEAN      NOT NULL DEFAULT false,
  -- Hashed identifiers: HMAC-SHA256(document_number + user_id).
  -- Raw document numbers are NEVER stored; only the hash for dedup.
  ADD COLUMN IF NOT EXISTS bvn_hash     TEXT,
  ADD COLUMN IF NOT EXISTS nin_hash     TEXT,
  ADD COLUMN IF NOT EXISTS document_type TEXT
                                        CHECK (document_type IN ('BVN','NIN','PASSPORT','DRIVERS_LICENSE')),
  -- Provider reference (Sumsub, Smile Identity, etc.) — not the document number.
  ADD COLUMN IF NOT EXISTS document_ref TEXT;

-- Index for per-tier queries (wallet limit checks, vote gate)
CREATE INDEX IF NOT EXISTS idx_user_profiles_kyc_tier
  ON public.user_profiles (kyc_tier);

-- Index for KYC admin queries (find all pending)
CREATE INDEX IF NOT EXISTS idx_user_profiles_kyc_status
  ON public.user_profiles (kyc_status)
  WHERE kyc_status IN ('pending', 'failed', 'suspended');

COMMIT;
