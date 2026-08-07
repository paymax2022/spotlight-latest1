-- Paymax Connect — account deletion / data-subject-request (DSR) marker
-- Ref: Spotlight_Connect_Test_Plan rows ON-010, EC-011, MB-020; privacy invariants.
--
-- Adds a soft-deletion marker to connect_profiles so a deleted account can be
-- anonymised-in-place (partner sees a graceful "Deleted user" state instead of a
-- broken thread) while the row remains for referential integrity. The deletion
-- cascade (backend/internal/connect/account) sets this alongside PII anonymisation.
--
-- Additive-only: ADD COLUMN IF NOT EXISTS. No column is dropped, renamed, or
-- narrowed; existing rows keep deleted_at = NULL (i.e., active).

BEGIN;

ALTER TABLE public.connect_profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Partial index for "active profiles only" scans used by discovery/search.
CREATE INDEX IF NOT EXISTS connect_profiles_active_idx
  ON public.connect_profiles (id)
  WHERE deleted_at IS NULL;

COMMIT;
