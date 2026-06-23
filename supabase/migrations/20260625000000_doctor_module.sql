-- ════════════════════════════════════════════════════════════════════════════
-- Doctor (Telemedicine, provider) Module — full domain schema
-- ════════════════════════════════════════════════════════════════════════════
-- ADDITIVE ONLY. Iron rules honoured:
--   * No DROP, no column rename, no type narrowing. CREATE ... IF NOT EXISTS only.
--   * All monetary amounts are integers in MINOR units (kobo) → BIGINT *_kobo.
--   * Earnings / wallet balances are PROJECTIONS of the double-entry ledger
--     (public.ledger_accounts / public.ledger_entries). This migration stores
--     payout REQUESTS and invoices — never a mutable balance column.
--   * Every money mutation needs an Idempotency-Key (carried on payout/invoice
--     rows as a UNIQUE idempotency_key) + an audit row (doctor_compliance_audit).
--   * RLS on every table: a doctor reads/writes ONLY their own rows
--     (auth.uid() = user_id); child rows are gated through their parent's user_id;
--     service_role bypasses RLS and is the only privileged writer.
--   * Feature-flagged off in the app layer (FEATURE_DOCTOR_ENABLED).
--
-- Shape decisions:
--   * Child tables for first-class lists that are queried/joined independently
--     (appointments, prescription_items, lab_result_values, chat_messages, …).
--   * JSONB for free-form / highly-variable nested config (availability rules,
--     settings blobs, SOAP rich sections, vitals, document arrays) to keep the
--     table count sane without losing structure.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PROFILE & VERIFICATION
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.doctor_profiles (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    provider_type     text NOT NULL DEFAULT 'doctor'
                          CHECK (provider_type IN ('doctor','specialist','veterinarian')),
    name              text,
    title             text,                       -- "MBBS, FWACP"
    specialty_id      text,
    specialties       jsonb NOT NULL DEFAULT '[]'::jsonb,
    sub_specialties   jsonb NOT NULL DEFAULT '[]'::jsonb,
    bio               text,
    initials          text,
    avatar_color      text,
    avatar_url        text,
    email             text,
    phone             text,
    mdcn_number       text,
    fee_kobo          bigint NOT NULL DEFAULT 0,
    rating            numeric(3,2) NOT NULL DEFAULT 0,
    review_count      integer NOT NULL DEFAULT 0,
    years_experience  integer NOT NULL DEFAULT 0,
    languages         jsonb NOT NULL DEFAULT '[]'::jsonb,
    hospital          text,
    state             text,
    is_online         boolean NOT NULL DEFAULT false,
    presence          text NOT NULL DEFAULT 'offline'
                          CHECK (presence IN ('online','offline','busy','away')),
    verification      text NOT NULL DEFAULT 'unsubmitted'
                          CHECK (verification IN ('unsubmitted','pending','approved','rejected')),
    timezone          text NOT NULL DEFAULT 'Africa/Lagos',
    is_published      boolean NOT NULL DEFAULT false,
    active_clinic_id  uuid,
    -- profile builder (Section B) lives in JSONB so the wizard can patch freely.
    profile_draft     jsonb NOT NULL DEFAULT '{}'::jsonb,
    completed_steps   jsonb NOT NULL DEFAULT '[]'::jsonb,
    tax_info          jsonb,
    free_follow_up    jsonb,
    pricing           jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_profiles_user ON public.doctor_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_profiles_verification ON public.doctor_profiles(verification);

CREATE TABLE IF NOT EXISTS public.doctor_verifications (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status            text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('unsubmitted','pending','approved','rejected')),
    kind              text NOT NULL DEFAULT 'initial'
                          CHECK (kind IN ('initial','renewal','resubmission')),
    mdcn_number       text,
    submitted_at      timestamptz,
    reviewed_at       timestamptz,
    reviewer          text,
    rejection_reason  text,
    rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
    notes             text,
    decision_outcome  text CHECK (decision_outcome IS NULL OR decision_outcome IN ('approved','rejected')),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_verifications_user ON public.doctor_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_verifications_status ON public.doctor_verifications(status);

CREATE TABLE IF NOT EXISTS public.doctor_verification_documents (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    verification_id   uuid REFERENCES public.doctor_verifications(id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    doc_type          text NOT NULL,              -- mdcn_certificate, medical_license, …
    label             text,
    file_name         text,
    file_url          text,
    mime_type         text,
    size_bytes        bigint,
    required          boolean NOT NULL DEFAULT false,
    uploaded_at       timestamptz NOT NULL DEFAULT now(),
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_verif_docs_verif ON public.doctor_verification_documents(verification_id);
CREATE INDEX IF NOT EXISTS idx_doctor_verif_docs_user ON public.doctor_verification_documents(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_legal_consents (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    consent_kind      text NOT NULL,             -- terms, privacy, no_advice, …
    version           text NOT NULL DEFAULT 'v1',
    accepted          boolean NOT NULL DEFAULT false,
    accepted_at       timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, consent_kind, version)
);
CREATE INDEX IF NOT EXISTS idx_doctor_legal_consents_user ON public.doctor_legal_consents(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_app_permissions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    permission_kind   text NOT NULL,             -- camera, microphone, notifications, …
    state             text NOT NULL DEFAULT 'undetermined'
                          CHECK (state IN ('granted','denied','undetermined')),
    decided_at        timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, permission_kind)
);
CREATE INDEX IF NOT EXISTS idx_doctor_app_permissions_user ON public.doctor_app_permissions(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_merchant_upgrades (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    state             text NOT NULL DEFAULT 'not_started',
    requested_at      timestamptz,
    completed_at      timestamptz,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_merchant_upgrades_user ON public.doctor_merchant_upgrades(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SCHEDULE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.doctor_availability (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    working_days          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{day,enabled,startTime,endTime}]
    breaks                jsonb NOT NULL DEFAULT '[]'::jsonb,
    rules                 jsonb NOT NULL DEFAULT '{}'::jsonb,   -- free-form availability config
    consult_duration_mins integer NOT NULL DEFAULT 30,
    buffer_mins           integer NOT NULL DEFAULT 0,
    accepts_instant       boolean NOT NULL DEFAULT false,
    emergency_enabled     boolean NOT NULL DEFAULT false,
    timezone              text NOT NULL DEFAULT 'Africa/Lagos',
    reminder_settings     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_availability_user ON public.doctor_availability(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_blocked_dates (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    blocked_date      date NOT NULL,
    reason            text,
    all_day           boolean NOT NULL DEFAULT true,
    start_time        text,
    end_time          text,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_blocked_dates_user ON public.doctor_blocked_dates(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_blocked_dates_date ON public.doctor_blocked_dates(blocked_date);

CREATE TABLE IF NOT EXISTS public.doctor_vacations (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    start_date        date NOT NULL,
    end_date          date NOT NULL,
    note              text,
    active            boolean NOT NULL DEFAULT true,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_vacations_user ON public.doctor_vacations(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_recurring_rules (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    rule              jsonb NOT NULL DEFAULT '{}'::jsonb,
    active            boolean NOT NULL DEFAULT true,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_recurring_rules_user ON public.doctor_recurring_rules(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_reminders (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    reminder_type     text NOT NULL,
    settings          jsonb NOT NULL DEFAULT '{}'::jsonb,
    enabled           boolean NOT NULL DEFAULT true,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_reminders_user ON public.doctor_reminders(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. APPOINTMENTS & CONSULTS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.doctor_appointments (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,   -- owning doctor
    ref               text,
    patient_id        text,
    patient           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- denormalised PatientSummary
    consult_type      text,
    status            text NOT NULL DEFAULT 'pending',
    slot_date         date,
    slot_time         text,
    fee_kobo          bigint NOT NULL DEFAULT 0,
    reason            text,
    is_hmo            boolean NOT NULL DEFAULT false,
    hmo_provider      text,
    started_at        timestamptz,
    ended_at          timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_appointments_user ON public.doctor_appointments(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_appointments_status ON public.doctor_appointments(status);
CREATE INDEX IF NOT EXISTS idx_doctor_appointments_slot ON public.doctor_appointments(slot_date);

CREATE TABLE IF NOT EXISTS public.doctor_appointment_requests (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    appointment_id    uuid REFERENCES public.doctor_appointments(id) ON DELETE SET NULL,
    patient           jsonb NOT NULL DEFAULT '{}'::jsonb,
    consult_type      text,
    status            text NOT NULL DEFAULT 'pending',
    requested_slot    text,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_appt_requests_user ON public.doctor_appointment_requests(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_consult_queue (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    appointment_id    uuid REFERENCES public.doctor_appointments(id) ON DELETE CASCADE,
    position          integer NOT NULL DEFAULT 0,
    status            text NOT NULL DEFAULT 'waiting',
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_consult_queue_user ON public.doctor_consult_queue(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_chat_threads (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    appointment_id    uuid REFERENCES public.doctor_appointments(id) ON DELETE SET NULL,
    patient           jsonb NOT NULL DEFAULT '{}'::jsonb,
    consult_type      text,
    status            text NOT NULL DEFAULT 'active',
    last_message      text,
    last_message_at   timestamptz,
    unread_count      integer NOT NULL DEFAULT 0,
    state             jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_chat_threads_user ON public.doctor_chat_threads(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_chat_messages (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id         uuid NOT NULL REFERENCES public.doctor_chat_threads(id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,   -- owning doctor
    author            text NOT NULL DEFAULT 'doctor' CHECK (author IN ('doctor','patient')),
    body              text,
    message_kind      text NOT NULL DEFAULT 'text',   -- text|voice|attachment|share|annotation
    attachment_url    text,
    attachment_name   text,
    annotations       jsonb,
    reported          boolean NOT NULL DEFAULT false,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_chat_messages_thread ON public.doctor_chat_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_doctor_chat_messages_user ON public.doctor_chat_messages(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_call_sessions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    appointment_id    uuid REFERENCES public.doctor_appointments(id) ON DELETE SET NULL,
    patient           jsonb NOT NULL DEFAULT '{}'::jsonb,
    mode              text NOT NULL DEFAULT 'audio' CHECK (mode IN ('audio','video')),
    status            text NOT NULL DEFAULT 'connecting'
                          CHECK (status IN ('connecting','ringing','live','ended','failed')),
    provider          text,
    room_token        text,
    started_at        timestamptz,
    ended_at          timestamptz,
    duration_secs     integer NOT NULL DEFAULT 0,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_call_sessions_user ON public.doctor_call_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_call_sessions_appt ON public.doctor_call_sessions(appointment_id);

CREATE TABLE IF NOT EXISTS public.doctor_call_disputes (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    call_session_id   uuid REFERENCES public.doctor_call_sessions(id) ON DELETE SET NULL,
    appointment_id    uuid REFERENCES public.doctor_appointments(id) ON DELETE SET NULL,
    status            text NOT NULL DEFAULT 'open',
    reason            text,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_call_disputes_user ON public.doctor_call_disputes(user_id);

-- SOAP + rich clinical notes (subjective/objective/assessment/plan + JSONB sections).
CREATE TABLE IF NOT EXISTS public.doctor_clinical_notes (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    appointment_id    uuid REFERENCES public.doctor_appointments(id) ON DELETE CASCADE,
    patient_id        text,
    subjective        text,
    objective         text,
    assessment        text,
    plan              text,
    diagnosis         jsonb NOT NULL DEFAULT '[]'::jsonb,
    sections          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- rich/extended SOAP content
    status            text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','finalized','shared')),
    finalized_at      timestamptz,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_clinical_notes_user ON public.doctor_clinical_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_clinical_notes_appt ON public.doctor_clinical_notes(appointment_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PRESCRIPTIONS & PHARMACY
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.doctor_prescriptions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ref               text,
    appointment_id    uuid REFERENCES public.doctor_appointments(id) ON DELETE SET NULL,
    patient_id        text,
    patient           jsonb NOT NULL DEFAULT '{}'::jsonb,
    diagnosis         text,
    status            text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','issued','dispensed','cancelled')),
    issued_at         timestamptz,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_prescriptions_user ON public.doctor_prescriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_prescriptions_status ON public.doctor_prescriptions(status);

CREATE TABLE IF NOT EXISTS public.doctor_prescription_items (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_id   uuid NOT NULL REFERENCES public.doctor_prescriptions(id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name              text NOT NULL,
    dosage            text,
    route             text,
    frequency         text,
    duration          text,
    notes             text,
    position          integer NOT NULL DEFAULT 0,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_rx_items_rx ON public.doctor_prescription_items(prescription_id);
CREATE INDEX IF NOT EXISTS idx_doctor_rx_items_user ON public.doctor_prescription_items(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_prescription_audit (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_id   uuid NOT NULL REFERENCES public.doctor_prescriptions(id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    action            text NOT NULL,             -- created|issued|cancelled|shared|sent_to_pharmacy
    prev_status       text,
    new_status        text,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_rx_audit_rx ON public.doctor_prescription_audit(prescription_id);

CREATE TABLE IF NOT EXISTS public.doctor_pharmacy_fulfilments (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    prescription_id   uuid REFERENCES public.doctor_prescriptions(id) ON DELETE SET NULL,
    pharmacy_id       text,
    pharmacy          jsonb NOT NULL DEFAULT '{}'::jsonb,
    status            text NOT NULL DEFAULT 'pending',
    total_kobo        bigint NOT NULL DEFAULT 0,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_pharm_fulfil_user ON public.doctor_pharmacy_fulfilments(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_pharm_fulfil_rx ON public.doctor_pharmacy_fulfilments(prescription_id);

CREATE TABLE IF NOT EXISTS public.doctor_pharmacy_substitutes (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fulfilment_id     uuid NOT NULL REFERENCES public.doctor_pharmacy_fulfilments(id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    original_drug     text,
    substitute_drug   text,
    status            text NOT NULL DEFAULT 'proposed',   -- proposed|approved|rejected
    price_kobo        bigint NOT NULL DEFAULT 0,
    reviewed_at       timestamptz,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_pharm_subs_fulfil ON public.doctor_pharmacy_substitutes(fulfilment_id);
CREATE INDEX IF NOT EXISTS idx_doctor_pharm_subs_user ON public.doctor_pharmacy_substitutes(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_drug_deliveries (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fulfilment_id     uuid REFERENCES public.doctor_pharmacy_fulfilments(id) ON DELETE SET NULL,
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status            text NOT NULL DEFAULT 'pending',
    courier           text,
    tracking_ref      text,
    eta               timestamptz,
    delivered_at      timestamptz,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_drug_deliveries_user ON public.doctor_drug_deliveries(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_refill_requests (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    prescription_id   uuid REFERENCES public.doctor_prescriptions(id) ON DELETE SET NULL,
    patient           jsonb NOT NULL DEFAULT '{}'::jsonb,
    status            text NOT NULL DEFAULT 'pending',   -- pending|approved|rejected|consultation_required
    reviewed_at       timestamptz,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_refill_requests_user ON public.doctor_refill_requests(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_pharmacy_messages (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fulfilment_id     uuid NOT NULL REFERENCES public.doctor_pharmacy_fulfilments(id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    author            text NOT NULL DEFAULT 'doctor',
    body              text,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_pharm_msgs_fulfil ON public.doctor_pharmacy_messages(fulfilment_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. LABS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.doctor_lab_orders (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ref               text,
    appointment_id    uuid REFERENCES public.doctor_appointments(id) ON DELETE SET NULL,
    patient_id        text,
    patient           jsonb NOT NULL DEFAULT '{}'::jsonb,
    clinical_note     text,
    status            text NOT NULL DEFAULT 'ordered'
                          CHECK (status IN ('ordered','collected','resulted','reviewed','cancelled')),
    priority          text NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine','urgent')),
    lab_provider      text,
    ordered_at        timestamptz NOT NULL DEFAULT now(),
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_lab_orders_user ON public.doctor_lab_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_lab_orders_status ON public.doctor_lab_orders(status);

CREATE TABLE IF NOT EXISTS public.doctor_lab_order_tests (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id          uuid NOT NULL REFERENCES public.doctor_lab_orders(id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    test_id           text,
    name              text,
    code              text,
    category          text,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_lab_order_tests_order ON public.doctor_lab_order_tests(order_id);

CREATE TABLE IF NOT EXISTS public.doctor_lab_results (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    order_id          uuid REFERENCES public.doctor_lab_orders(id) ON DELETE SET NULL,
    ref               text,
    patient           jsonb NOT NULL DEFAULT '{}'::jsonb,
    lab_name          text,
    reported_at       timestamptz,
    reviewed          boolean NOT NULL DEFAULT false,
    reviewed_at       timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_lab_results_user ON public.doctor_lab_results(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_lab_results_order ON public.doctor_lab_results(order_id);

CREATE TABLE IF NOT EXISTS public.doctor_lab_result_values (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    result_id         uuid NOT NULL REFERENCES public.doctor_lab_results(id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    test_name         text,
    value             text,
    unit              text,
    ref_range         text,
    flag              text CHECK (flag IS NULL OR flag IN ('normal','low','high')),
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_lab_result_values_result ON public.doctor_lab_result_values(result_id);

CREATE TABLE IF NOT EXISTS public.doctor_lab_interpretations (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    result_id         uuid NOT NULL REFERENCES public.doctor_lab_results(id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    interpretation    text,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_lab_interp_result ON public.doctor_lab_interpretations(result_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. HMO
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.doctor_hmo_plan_coverage (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    patient_id        text,
    provider          text,
    plan_name         text,
    member_id         text,
    valid_until       date,
    copay_kobo        bigint NOT NULL DEFAULT 0,
    coverage          jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_hmo_coverage_user ON public.doctor_hmo_plan_coverage(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_hmo_preauth_requests (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    patient_id        text,
    appointment_id    uuid REFERENCES public.doctor_appointments(id) ON DELETE SET NULL,
    status            text NOT NULL DEFAULT 'pending',
    auth_code         text,
    amount_kobo       bigint NOT NULL DEFAULT 0,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_hmo_preauth_user ON public.doctor_hmo_preauth_requests(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_hmo_covered_services (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    service_name      text NOT NULL,
    provider          text,
    covered           boolean NOT NULL DEFAULT true,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_hmo_services_user ON public.doctor_hmo_covered_services(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_hmo_claims (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ref               text,
    patient_id        text,
    appointment_id    uuid REFERENCES public.doctor_appointments(id) ON DELETE SET NULL,
    status            text NOT NULL DEFAULT 'submitted',
    amount_kobo       bigint NOT NULL DEFAULT 0,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_hmo_claims_user ON public.doctor_hmo_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_hmo_claims_status ON public.doctor_hmo_claims(status);

CREATE TABLE IF NOT EXISTS public.doctor_hmo_support_messages (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    thread_id         text NOT NULL,
    author            text NOT NULL DEFAULT 'doctor',
    body              text,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_hmo_support_user ON public.doctor_hmo_support_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_hmo_support_thread ON public.doctor_hmo_support_messages(thread_id);

CREATE TABLE IF NOT EXISTS public.doctor_hmo_fraud_warnings (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    severity          text NOT NULL DEFAULT 'medium',
    acknowledged      boolean NOT NULL DEFAULT false,
    acknowledged_at   timestamptz,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_hmo_fraud_user ON public.doctor_hmo_fraud_warnings(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. COLLABORATION & CARE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.doctor_referrals (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,   -- referring doctor
    specialist_id     text,
    patient_id        text,
    direction         text NOT NULL DEFAULT 'outgoing' CHECK (direction IN ('outgoing','incoming')),
    status            text NOT NULL DEFAULT 'pending',
    reason            text,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_referrals_user ON public.doctor_referrals(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_referrals_direction ON public.doctor_referrals(direction);

CREATE TABLE IF NOT EXISTS public.doctor_incoming_referrals (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,   -- receiving doctor
    referring_doctor  text,
    patient_id        text,
    status            text NOT NULL DEFAULT 'pending',
    reason            text,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_incoming_refs_user ON public.doctor_incoming_referrals(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_opinion_requests (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    patient_id        text,
    status            text NOT NULL DEFAULT 'pending',
    question          text,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_opinion_reqs_user ON public.doctor_opinion_requests(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_care_team_messages (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    thread_id         text NOT NULL,
    author            text NOT NULL DEFAULT 'doctor',
    body              text,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_care_team_user ON public.doctor_care_team_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_care_team_thread ON public.doctor_care_team_messages(thread_id);

CREATE TABLE IF NOT EXISTS public.doctor_follow_up_plans (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    patient_id        text,
    appointment_id    uuid REFERENCES public.doctor_appointments(id) ON DELETE SET NULL,
    status            text NOT NULL DEFAULT 'scheduled',
    kind              text NOT NULL DEFAULT 'standard',   -- standard|emergency
    due_at            timestamptz,
    reminder_set      boolean NOT NULL DEFAULT false,
    completed_at      timestamptz,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_follow_ups_user ON public.doctor_follow_up_plans(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_care_plans (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    patient_id        text,
    title             text,
    status            text NOT NULL DEFAULT 'active',
    plan              jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_care_plans_user ON public.doctor_care_plans(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_chronic_monitoring (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    patient_id        text,
    condition         text,
    readings          jsonb NOT NULL DEFAULT '[]'::jsonb,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_chronic_user ON public.doctor_chronic_monitoring(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_adherence_checks (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    patient_id        text,
    prescription_id   uuid REFERENCES public.doctor_prescriptions(id) ON DELETE SET NULL,
    status            text NOT NULL DEFAULT 'pending',
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_adherence_user ON public.doctor_adherence_checks(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_emergency_facilities (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name              text,
    facility_type     text,                       -- hospital|ambulance|clinic
    location          jsonb NOT NULL DEFAULT '{}'::jsonb,
    contact           jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_emerg_facilities_user ON public.doctor_emergency_facilities(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_emergency_escalations (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    patient_id        text,
    escalation_type   text NOT NULL CHECK (escalation_type IN ('hospital','ambulance','contact')),
    facility_id       uuid REFERENCES public.doctor_emergency_facilities(id) ON DELETE SET NULL,
    status            text NOT NULL DEFAULT 'initiated',
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_emerg_escal_user ON public.doctor_emergency_escalations(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_emergency_cases (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    patient_id        text,
    status            text NOT NULL DEFAULT 'open',
    summary           text,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_emerg_cases_user ON public.doctor_emergency_cases(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. VET / PET
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.doctor_vet_profiles (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    vet_mode_enabled  boolean NOT NULL DEFAULT false,
    licence_number    text,
    verification      text NOT NULL DEFAULT 'unsubmitted'
                          CHECK (verification IN ('unsubmitted','pending','approved','rejected')),
    is_published      boolean NOT NULL DEFAULT false,
    profile_draft     jsonb NOT NULL DEFAULT '{}'::jsonb,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_vet_profiles_user ON public.doctor_vet_profiles(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_pets (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,   -- treating vet
    owner_ref         text,
    name              text,
    species           text,
    breed             text,
    profile           jsonb NOT NULL DEFAULT '{}'::jsonb,
    growth_history    jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_pets_user ON public.doctor_pets(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_pet_vaccinations (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pet_id            uuid NOT NULL REFERENCES public.doctor_pets(id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    vaccine           text,
    due_at            timestamptz,
    administered_at   timestamptz,
    reminder_set      boolean NOT NULL DEFAULT false,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_pet_vacc_pet ON public.doctor_pet_vaccinations(pet_id);

CREATE TABLE IF NOT EXISTS public.doctor_pet_prescriptions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    pet_id            uuid REFERENCES public.doctor_pets(id) ON DELETE SET NULL,
    ref               text,
    status            text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','issued','dispensed','cancelled')),
    items             jsonb NOT NULL DEFAULT '[]'::jsonb,
    issued_at         timestamptz,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_pet_rx_user ON public.doctor_pet_prescriptions(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_pet_lab_orders (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    pet_id            uuid REFERENCES public.doctor_pets(id) ON DELETE SET NULL,
    ref               text,
    status            text NOT NULL DEFAULT 'ordered',
    tests             jsonb NOT NULL DEFAULT '[]'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_pet_lab_orders_user ON public.doctor_pet_lab_orders(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_pet_lab_results (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    order_id          uuid REFERENCES public.doctor_pet_lab_orders(id) ON DELETE SET NULL,
    reviewed          boolean NOT NULL DEFAULT false,
    reviewed_at       timestamptz,
    values            jsonb NOT NULL DEFAULT '[]'::jsonb,
    interpretation    text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_pet_lab_results_user ON public.doctor_pet_lab_results(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_pet_products (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name              text,
    category          text,
    price_kobo        bigint NOT NULL DEFAULT 0,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_pet_products_user ON public.doctor_pet_products(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_pet_recommendations (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    pet_id            uuid REFERENCES public.doctor_pets(id) ON DELETE SET NULL,
    product_id        uuid REFERENCES public.doctor_pet_products(id) ON DELETE SET NULL,
    status            text NOT NULL DEFAULT 'recommended',   -- recommended|shared
    shared_at         timestamptz,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_pet_recs_user ON public.doctor_pet_recommendations(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_pet_fulfilments (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id        uuid REFERENCES public.doctor_pet_products(id) ON DELETE SET NULL,
    pet_id            uuid REFERENCES public.doctor_pets(id) ON DELETE SET NULL,
    status            text NOT NULL DEFAULT 'pending',
    total_kobo        bigint NOT NULL DEFAULT 0,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_pet_fulfil_user ON public.doctor_pet_fulfilments(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. RECORDS & REPUTATION
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.doctor_record_access_log (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    patient_id        text,
    action            text NOT NULL,             -- view|export|share|access_request
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_record_access_user ON public.doctor_record_access_log(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_record_access_patient ON public.doctor_record_access_log(patient_id);

CREATE TABLE IF NOT EXISTS public.doctor_record_restrictions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    patient_id        text,
    scope             text,
    restricted        boolean NOT NULL DEFAULT true,
    reason            text,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_record_restr_user ON public.doctor_record_restrictions(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_record_shares (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    patient_id        text,
    shared_with       text,
    status            text NOT NULL DEFAULT 'active',
    expires_at        timestamptz,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_record_shares_user ON public.doctor_record_shares(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_reviews (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,   -- reviewed doctor
    rating            smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
    body              text,
    reported          boolean NOT NULL DEFAULT false,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_reviews_user ON public.doctor_reviews(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_consultation_feedback (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    appointment_id    uuid REFERENCES public.doctor_appointments(id) ON DELETE SET NULL,
    rating            smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
    comment           text,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_consult_feedback_user ON public.doctor_consultation_feedback(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_quality_scores (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    score             numeric(6,2) NOT NULL DEFAULT 0,
    period_label      text,
    ranking           jsonb NOT NULL DEFAULT '{}'::jsonb,
    recommendations   jsonb NOT NULL DEFAULT '[]'::jsonb,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_quality_scores_user ON public.doctor_quality_scores(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_review_disputes (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    review_id         uuid REFERENCES public.doctor_reviews(id) ON DELETE SET NULL,
    kind              text NOT NULL DEFAULT 'dispute' CHECK (kind IN ('dispute','removal_request','report')),
    status            text NOT NULL DEFAULT 'open',
    reason            text,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_review_disputes_user ON public.doctor_review_disputes(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. MONEY (payouts / invoices / disputes / bank / commission)
--     Balances are ledger projections — NO stored balance columns here.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.doctor_bank_accounts (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    bank_name         text,
    bank_code         text,
    account_number    text,                       -- store last-4 masked at API layer; full only when policy allows
    account_name      text,
    is_verified       boolean NOT NULL DEFAULT false,
    is_default        boolean NOT NULL DEFAULT false,
    tax_info          jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_bank_accounts_user ON public.doctor_bank_accounts(user_id);

-- Payout REQUESTS only. The actual money movement is a balanced double-entry post
-- on public.ledger_entries; ledger_ref links the request to that posting.
CREATE TABLE IF NOT EXISTS public.doctor_payouts (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ref               text,
    amount_kobo       bigint NOT NULL CHECK (amount_kobo > 0),
    currency          text NOT NULL DEFAULT 'NGN',
    status            text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','processing','paid','failed','reversed')),
    bank_account_id   uuid REFERENCES public.doctor_bank_accounts(id) ON DELETE SET NULL,
    consult_count     integer NOT NULL DEFAULT 0,
    period_label      text,
    ledger_ref        text,                       -- reference into public.ledger_entries
    provider_reference text,
    failure_reason    text,
    requested_at      timestamptz NOT NULL DEFAULT now(),
    paid_at           timestamptz,
    idempotency_key   text NOT NULL UNIQUE,       -- required: every money mutation is idempotent
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_payouts_user ON public.doctor_payouts(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_payouts_status ON public.doctor_payouts(status);
CREATE INDEX IF NOT EXISTS idx_doctor_payouts_ledger_ref ON public.doctor_payouts(ledger_ref);

CREATE TABLE IF NOT EXISTS public.doctor_invoices (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ref               text,
    appointment_id    uuid REFERENCES public.doctor_appointments(id) ON DELETE SET NULL,
    gross_kobo        bigint NOT NULL DEFAULT 0,
    commission_kobo   bigint NOT NULL DEFAULT 0,
    vat_kobo          bigint NOT NULL DEFAULT 0,
    net_kobo          bigint NOT NULL DEFAULT 0,
    currency          text NOT NULL DEFAULT 'NGN',
    status            text NOT NULL DEFAULT 'issued',
    ledger_ref        text,
    issued_at         timestamptz NOT NULL DEFAULT now(),
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_invoices_user ON public.doctor_invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_invoices_status ON public.doctor_invoices(status);

CREATE TABLE IF NOT EXISTS public.doctor_settlement_disputes (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    payout_id         uuid REFERENCES public.doctor_payouts(id) ON DELETE SET NULL,
    status            text NOT NULL DEFAULT 'open',
    reason            text,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_settle_disputes_user ON public.doctor_settlement_disputes(user_id);

-- Commission configuration (per-doctor overrides; platform default applied otherwise).
CREATE TABLE IF NOT EXISTS public.doctor_commission_config (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    commission_bps      integer NOT NULL DEFAULT 0,   -- basis points (1% = 100 bps)
    vat_bps             integer NOT NULL DEFAULT 0,
    payout_cycle        text NOT NULL DEFAULT 'biweekly',
    detail              jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_commission_user ON public.doctor_commission_config(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. NOTIFICATIONS / SUPPORT / COMPLIANCE / SETTINGS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.doctor_notifications (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    notif_type        text NOT NULL DEFAULT 'system',
    title             text,
    body              text,
    group_key         text,
    read              boolean NOT NULL DEFAULT false,
    read_at           timestamptz,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_notifications_user ON public.doctor_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_notifications_read ON public.doctor_notifications(read);

CREATE TABLE IF NOT EXISTS public.doctor_notification_preferences (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    channel           text NOT NULL,             -- push|email|sms|in_app
    category          text NOT NULL,
    enabled           boolean NOT NULL DEFAULT true,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, channel, category)
);
CREATE INDEX IF NOT EXISTS idx_doctor_notif_prefs_user ON public.doctor_notification_preferences(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_support_tickets (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ref               text,
    subject           text,
    category          text,
    status            text NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','in_progress','resolved','closed')),
    last_reply        text,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_support_tickets_user ON public.doctor_support_tickets(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_support_disputes (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status            text NOT NULL DEFAULT 'open',
    subject           text,
    evidence          jsonb NOT NULL DEFAULT '[]'::jsonb,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_support_disputes_user ON public.doctor_support_disputes(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_support_messages (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    thread_id         text NOT NULL,
    ticket_id         uuid REFERENCES public.doctor_support_tickets(id) ON DELETE SET NULL,
    author            text NOT NULL DEFAULT 'doctor',
    body              text,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_support_msgs_user ON public.doctor_support_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_support_msgs_thread ON public.doctor_support_messages(thread_id);

-- Immutable audit of sensitive provider actions (money, PII, security, compliance).
CREATE TABLE IF NOT EXISTS public.doctor_compliance_audit (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    action            text NOT NULL,
    entity_type       text,
    entity_id         text,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text,
    ip_address        text,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_compliance_audit_user ON public.doctor_compliance_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_compliance_audit_entity ON public.doctor_compliance_audit(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS public.doctor_mandatory_training (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    module_id         text NOT NULL,
    title             text,
    status            text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','in_progress','completed')),
    completed_at      timestamptz,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, module_id)
);
CREATE INDEX IF NOT EXISTS idx_doctor_training_user ON public.doctor_mandatory_training(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_safety_issues (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    severity          text NOT NULL DEFAULT 'medium',
    status            text NOT NULL DEFAULT 'open',
    subject           text,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key   text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_safety_issues_user ON public.doctor_safety_issues(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_data_privacy_settings (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    settings          jsonb NOT NULL DEFAULT '{}'::jsonb,
    export_requested_at timestamptz,
    deletion_requested_at timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_privacy_user ON public.doctor_data_privacy_settings(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_devices (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_label      text,
    platform          text,
    last_seen_at      timestamptz,
    revoked           boolean NOT NULL DEFAULT false,
    revoked_at        timestamptz,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_devices_user ON public.doctor_devices(user_id);

CREATE TABLE IF NOT EXISTS public.doctor_settings (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    notify_appointments   boolean NOT NULL DEFAULT true,
    notify_messages       boolean NOT NULL DEFAULT true,
    notify_payouts        boolean NOT NULL DEFAULT true,
    push_enabled          boolean NOT NULL DEFAULT true,
    email_enabled         boolean NOT NULL DEFAULT true,
    sms_enabled           boolean NOT NULL DEFAULT false,
    show_online_status    boolean NOT NULL DEFAULT true,
    auto_accept_instant   boolean NOT NULL DEFAULT false,
    payout_bank_name      text,
    payout_account_masked text,
    preferred_currency    text NOT NULL DEFAULT 'NGN',
    biometric_enabled     boolean NOT NULL DEFAULT false,
    two_factor_enabled    boolean NOT NULL DEFAULT false,
    app_preferences       jsonb NOT NULL DEFAULT '{}'::jsonb,
    security              jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_settings_user ON public.doctor_settings(user_id);

-- ════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════════════════
-- Pattern:
--   * Tables with a direct user_id (the owning doctor): owner FOR ALL on auth.uid()=user_id.
--   * Child tables also carry a denormalised user_id (set to the owning doctor),
--     so the same auth.uid()=user_id policy applies uniformly.
--   * service_role bypasses RLS and is the privileged writer for system-driven rows
--     (ledger postings, provider callbacks, admin decisions).

DO $$
DECLARE
    t text;
    doctor_tables text[] := ARRAY[
        'doctor_profiles','doctor_verifications','doctor_verification_documents',
        'doctor_legal_consents','doctor_app_permissions','doctor_merchant_upgrades',
        'doctor_availability','doctor_blocked_dates','doctor_vacations',
        'doctor_recurring_rules','doctor_reminders',
        'doctor_appointments','doctor_appointment_requests','doctor_consult_queue',
        'doctor_chat_threads','doctor_chat_messages','doctor_call_sessions',
        'doctor_call_disputes','doctor_clinical_notes',
        'doctor_prescriptions','doctor_prescription_items','doctor_prescription_audit',
        'doctor_pharmacy_fulfilments','doctor_pharmacy_substitutes','doctor_drug_deliveries',
        'doctor_refill_requests','doctor_pharmacy_messages',
        'doctor_lab_orders','doctor_lab_order_tests','doctor_lab_results',
        'doctor_lab_result_values','doctor_lab_interpretations',
        'doctor_hmo_plan_coverage','doctor_hmo_preauth_requests','doctor_hmo_covered_services',
        'doctor_hmo_claims','doctor_hmo_support_messages','doctor_hmo_fraud_warnings',
        'doctor_referrals','doctor_incoming_referrals','doctor_opinion_requests',
        'doctor_care_team_messages','doctor_follow_up_plans','doctor_care_plans',
        'doctor_chronic_monitoring','doctor_adherence_checks','doctor_emergency_facilities',
        'doctor_emergency_escalations','doctor_emergency_cases',
        'doctor_vet_profiles','doctor_pets','doctor_pet_vaccinations','doctor_pet_prescriptions',
        'doctor_pet_lab_orders','doctor_pet_lab_results','doctor_pet_products',
        'doctor_pet_recommendations','doctor_pet_fulfilments',
        'doctor_record_access_log','doctor_record_restrictions','doctor_record_shares',
        'doctor_reviews','doctor_consultation_feedback','doctor_quality_scores','doctor_review_disputes',
        'doctor_bank_accounts','doctor_payouts','doctor_invoices','doctor_settlement_disputes',
        'doctor_commission_config',
        'doctor_notifications','doctor_notification_preferences','doctor_support_tickets',
        'doctor_support_disputes','doctor_support_messages','doctor_compliance_audit',
        'doctor_mandatory_training','doctor_safety_issues','doctor_data_privacy_settings',
        'doctor_devices','doctor_settings'
    ];
BEGIN
    FOREACH t IN ARRAY doctor_tables LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

        -- Owner (the doctor) reads/writes their own rows.
        EXECUTE format(
            'DROP POLICY IF EXISTS %I ON public.%I;',
            t || '_owner', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
            || 'USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);',
            t || '_owner', t);

        -- service_role bypasses RLS, but add an explicit permissive policy too
        -- so privileged server writes are unambiguous.
        EXECUTE format(
            'DROP POLICY IF EXISTS %I ON public.%I;',
            t || '_service', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO service_role '
            || 'USING (TRUE) WITH CHECK (TRUE);',
            t || '_service', t);
    END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- IMMUTABILITY NOTE
-- ════════════════════════════════════════════════════════════════════════════
-- doctor_payouts / doctor_invoices reference the double-entry ledger via
-- ledger_ref. They are request/record rows; the authoritative money movement is
-- on public.ledger_entries (append-only, corrections via reversing entries only).
-- doctor_prescription_audit and doctor_compliance_audit are append-only audit
-- logs — application + service_role only write; no UPDATE/DELETE is performed.

COMMIT;
