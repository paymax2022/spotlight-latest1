-- Telemedicine: a suspended clinician must not be able to put themselves back on
-- the patient-facing list or take bookings.
--
-- Suspension is recorded on doctor_profiles.verification = 'suspended' (the status
-- the doctor module and the mobile app read). The telemedicine booking path gates
-- on doctors.is_available, and ToggleDoctorAvailability lets the clinician flip that
-- flag themselves, so the profile status alone is not enough: a suspended doctor
-- could go "online" again and, because their earlier approved doctor_verifications
-- row still exists, pass the credential check. This trigger closes that hole at the
-- data layer: while a doctor_profiles row for the same user is suspended, doctors.
-- is_available / is_online are forced false on every insert or update.
--
-- Additive only: one function (CREATE OR REPLACE) and one trigger (created only
-- when absent). No columns, no data changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.doctors_block_when_suspended()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.is_available OR NEW.is_online) AND EXISTS (
    SELECT 1 FROM public.doctor_profiles p
    WHERE p.user_id = NEW.user_id AND p.verification = 'suspended'
  ) THEN
    NEW.is_available := false;
    NEW.is_online := false;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'doctors_block_when_suspended_trg'
      AND tgrelid = 'public.doctors'::regclass
  ) THEN
    CREATE TRIGGER doctors_block_when_suspended_trg
      BEFORE INSERT OR UPDATE OF is_available, is_online ON public.doctors
      FOR EACH ROW EXECUTE FUNCTION public.doctors_block_when_suspended();
  END IF;
END $$;

COMMIT;
