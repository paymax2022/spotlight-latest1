-- Align driver_documents.doc_type CHECK with the backend allow-list
-- (transport.driverDocTypes) and the mobile driver-onboarding vocabulary.
--
-- Bug: driver onboarding returned HTTP 500 ("internal server error") when a
-- driver uploaded their Vehicle Insurance. The backend presign gate
-- (driverDocTypes) and the mobile client both use doc_type 'vehicle_insurance',
-- but the original inline CHECK (migration 20260623000000) only allowed
-- 'insurance'. Presign + the R2 PUT succeeded, then INSERT INTO driver_documents
-- violated the CHECK and surfaced as a 500. Only insurance was affected because
-- every other required doc_type ('drivers_licence','government_id',
-- 'proof_of_address','roadworthiness') already matched the DB list.
--
-- Fix: widen the CHECK to the UNION of the previously-allowed values and the
-- full backend driverDocTypes vocabulary. This is a NON-DESTRUCTIVE widening --
-- the new set is a strict superset, so no existing row can be invalidated.
-- Idempotent and safe to re-run (DROP CONSTRAINT IF EXISTS then re-add, the same
-- pattern as 20260925000000_academy_moderation_state_widen).
DO $$
BEGIN
  IF to_regclass('public.driver_documents') IS NOT NULL THEN
    ALTER TABLE public.driver_documents
      DROP CONSTRAINT IF EXISTS driver_documents_doc_type_check;
    ALTER TABLE public.driver_documents
      ADD CONSTRAINT driver_documents_doc_type_check
      CHECK (doc_type IN (
        -- previously allowed (preserved)
        'government_id','drivers_licence','proof_of_address','vehicle_licence',
        'roadworthiness','insurance','driver_photo',
        -- backend driverDocTypes vocabulary (presign gate)
        'vehicle_insurance','license','vehicle_reg','road_worthiness','lasrra',
        'psv','profile_photo'
      ));
  END IF;
END $$;
