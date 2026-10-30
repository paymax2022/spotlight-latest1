-- TMFA verifiable credentials.
--
-- The academy_certificates table already exists (20260505110000_film_academy_admin_ops)
-- but nothing has ever written to it. This migration only ADDS the columns a
-- server-verified credential needs; it does not alter or delete existing rows.
--
-- A certificate is earned, never assigned: the issuing service recomputes the
-- whole topic ledger at issue time and records how many topics were required,
-- published and mastered. `qr_verification_code` (existing column) is the public
-- verification identifier; a unique index is safe because all existing rows hold
-- NULL there.

ALTER TABLE public.academy_certificates
  ADD COLUMN IF NOT EXISTS certificate_type text NOT NULL DEFAULT 'programme_completion',
  ADD COLUMN IF NOT EXISTS curriculum_label text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS topics_required integer,
  ADD COLUMN IF NOT EXISTS topics_mastered integer,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revocation_reason text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS academy_certificates_verification_code_idx
  ON public.academy_certificates (qr_verification_code)
  WHERE qr_verification_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS academy_certificates_enrollment_created_idx
  ON public.academy_certificates (enrollment_id, created_at DESC);

COMMENT ON COLUMN public.academy_certificates.topics_required IS
  'Total topic count in the curriculum at issue time. A credential is not issued until every one is published and mastered.';
COMMENT ON COLUMN public.academy_certificates.qr_verification_code IS
  'Public verification identifier. Lookup returns holder display name, programme and status only — no email, phone or user id.';
COMMENT ON COLUMN public.academy_certificates.revoked_at IS
  'Set only by an authorised revocation. Revoked credentials stay in the registry so a verifier sees the revocation, never a 404.';
