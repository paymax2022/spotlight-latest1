-- ADR-PR879: the telemedicine money audit and its appointments are backend-only.
--
-- doctor_compliance_audit now records who settled or refunded a consult and why,
-- and who read a patient's intake. Its "owner FOR ALL" row policy let the actor
-- recorded on a row update or delete it through PostgREST, so a doctor could
-- erase the settle row stamped with their id. appointments carries the patient's
-- free-text problem report (review_reason), which the assigned doctor could read
-- through the existing participant policy. Every reader and writer of both tables
-- is the Go backend (service_role), so the PostgREST roles get nothing
-- (ADR-PR858 pattern). Policies stay; with no privileges they no longer apply.
REVOKE ALL ON TABLE public.doctor_compliance_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.appointments            FROM PUBLIC, anon, authenticated;
GRANT  ALL ON TABLE public.doctor_compliance_audit TO service_role;
GRANT  ALL ON TABLE public.appointments            TO service_role;

-- One settle and one refund audit row per settlement. The backend writes them
-- with a deterministic idempotency key (tm:<action>:<settlement_id>), so the
-- reconciler's lost-row recovery cannot duplicate one when replicas race.
CREATE UNIQUE INDEX IF NOT EXISTS doctor_compliance_audit_tm_money_uniq
    ON public.doctor_compliance_audit (idempotency_key)
    WHERE idempotency_key LIKE 'tm:telemedicine.appointment.%';
