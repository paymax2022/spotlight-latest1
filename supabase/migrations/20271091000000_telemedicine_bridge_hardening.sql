-- ADR-PR879: harden the telemedicine ↔ doctor-console bridge.

-- ── One chat thread per appointment (review H-2) ────────────────────────────
-- The bridge resolves the patient's chat by appointment_id. A second thread on
-- the same appointment (planted, or a race) could capture patient messages, so
-- appointment_id is unique among threads that carry one. The index is only built
-- when no duplicates exist, so this migration never deletes or rewrites data; the
-- Go lookup is also restricted to the assigned doctor's thread, so an environment
-- that still has duplicates is safe and reports them here for manual cleanup.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
               AND indexname = 'doctor_chat_threads_appointment_uniq') THEN
        RETURN;
    END IF;
    IF EXISTS (SELECT appointment_id FROM public.doctor_chat_threads
               WHERE appointment_id IS NOT NULL
               GROUP BY appointment_id HAVING count(*) > 1) THEN
        RAISE WARNING 'doctor_chat_threads has duplicate appointment_id rows; unique index not created (ADR-PR879)';
        RETURN;
    END IF;
    CREATE UNIQUE INDEX doctor_chat_threads_appointment_uniq
        ON public.doctor_chat_threads (appointment_id) WHERE appointment_id IS NOT NULL;
END $$;

-- ── PostgREST lockdown (review M-6, ADR-PR858 pattern) ──────────────────────
-- Every reader and writer of these tables is the Go backend (service_role). Held
-- open, PostgREST let any user plant console rows that the bridge would show a
-- patient (a forged prescription or note, a hijacked chat thread), read and
-- truncate pre-consult intakes, and edit patient chat lines.
REVOKE ALL ON TABLE public.telemedicine_intakes      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.doctor_appointments       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.doctor_chat_threads       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.doctor_chat_messages      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.doctor_prescriptions      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.doctor_prescription_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.doctor_clinical_notes     FROM PUBLIC, anon, authenticated;
GRANT  ALL ON TABLE public.telemedicine_intakes      TO service_role;
GRANT  ALL ON TABLE public.doctor_appointments       TO service_role;
GRANT  ALL ON TABLE public.doctor_chat_threads       TO service_role;
GRANT  ALL ON TABLE public.doctor_chat_messages      TO service_role;
GRANT  ALL ON TABLE public.doctor_prescriptions      TO service_role;
GRANT  ALL ON TABLE public.doctor_prescription_items TO service_role;
GRANT  ALL ON TABLE public.doctor_clinical_notes     TO service_role;
