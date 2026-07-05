-- Paymax AI Symptom Checker (triage & navigation — NOT diagnosis). Phase-1 MVP.
-- Additive-only. Reuses health rails (records vault, consent, pharmacy/lab/telemed),
-- maps (nearest ER), wallet (pay for care), notifications + scheduler (follow-up),
-- llm (evidence extraction only). Enforces SC-1..SC-12 (release blockers).
BEGIN;

-- Family profiles the triage runs for (self/child/dependant). SC-9 paediatric/maternal.
CREATE TABLE IF NOT EXISTS public.health_triage_profiles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       text NOT NULL DEFAULT 'self' CHECK (kind IN ('self','child','dependant')),
  name       text,
  dob        date,
  sex        text,
  is_pregnant boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_triage_profiles_user ON public.health_triage_profiles(user_id);

-- Explicit consent to triage (SC-7 NDPA; immutable).
CREATE TABLE IF NOT EXISTS public.health_triage_consents (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.health_triage_profiles(id),
  scope      jsonb NOT NULL DEFAULT '{}'::jsonb,
  granted_at timestamptz NOT NULL DEFAULT now()
);

-- TriageSession SM: started→consented→interviewing→(red_flag→escalated)→assessed→
-- disposition_given→referred→closed|abandoned.
CREATE TABLE IF NOT EXISTS public.health_triage_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_id        uuid REFERENCES public.health_triage_profiles(id),
  state             text NOT NULL DEFAULT 'started'
                      CHECK (state IN ('started','consented','interviewing','red_flag_detected',
                                       'escalated','assessed','disposition_given','referred','closed','abandoned')),
  language          text NOT NULL DEFAULT 'en' CHECK (language IN ('en','pcm','ha','yo','ig')),
  channel           text NOT NULL DEFAULT 'app' CHECK (channel IN ('app','whatsapp','ussd','sms','agent')),
  consent_id        uuid REFERENCES public.health_triage_consents(id),
  disposition_level int,                              -- 1..5 (1=emergency .. 5=self-care)
  disposition_code  text,
  engine_ref        text,                             -- external engine session id (de-identified, SC-7)
  red_flag          boolean NOT NULL DEFAULT false,
  started_at        timestamptz NOT NULL DEFAULT now(),
  assessed_at       timestamptz,
  closed_at         timestamptz,
  idempotency_key   text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_triage_sessions_user ON public.health_triage_sessions(user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_triage_sessions_idem ON public.health_triage_sessions(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Raw symptom intake (text/body-map/voice-stub) per channel.
CREATE TABLE IF NOT EXISTS public.health_triage_intake (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.health_triage_sessions(id) ON DELETE CASCADE,
  raw_text   text,
  language   text,
  body_map   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Structured evidence consumed by the engine (symptom|risk_factor|answer). Immutable.
CREATE TABLE IF NOT EXISTS public.health_triage_evidence (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.health_triage_sessions(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('symptom','risk_factor','answer')),
  code       text NOT NULL,
  value      text,                                    -- present|absent|unknown / answer value
  source     text NOT NULL DEFAULT 'user' CHECK (source IN ('user','nlu','engine','region')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_triage_evidence_session ON public.health_triage_evidence(session_id);

-- Assessment = possible causes + 5-level disposition (NEVER a diagnosis, SC-1). Immutable.
CREATE TABLE IF NOT EXISTS public.health_triage_assessments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid NOT NULL REFERENCES public.health_triage_sessions(id) ON DELETE CASCADE,
  conditions         jsonb NOT NULL DEFAULT '[]'::jsonb,  -- possible causes (label+probability), not dx
  disposition_level  int NOT NULL,
  disposition_code   text NOT NULL,
  engine_payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  red_flag_triggered boolean NOT NULL DEFAULT false,
  rule_id            uuid,
  source             text NOT NULL DEFAULT 'engine' CHECK (source IN ('engine','red_flag','fallback')),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_triage_assess_session ON public.health_triage_assessments(session_id);

-- Deterministic RED-FLAG rules (always-override) + events. SC-2/SC-3/SC-6.
CREATE TABLE IF NOT EXISTS public.health_triage_red_flag_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,
  name             text NOT NULL,
  condition        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- evidence match expression
  urgency_level    int NOT NULL DEFAULT 1,              -- force disposition to (≤) this level
  severity         text NOT NULL DEFAULT 'emergency',
  state            text NOT NULL DEFAULT 'draft'
                     CHECK (state IN ('draft','clinical_review','approved','published','deprecated')),
  version          int NOT NULL DEFAULT 1,
  reviewer_id      uuid REFERENCES auth.users(id),
  published_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.health_triage_red_flag_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.health_triage_sessions(id) ON DELETE CASCADE,
  rule_id    uuid REFERENCES public.health_triage_red_flag_rules(id),
  severity   text,
  matched    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Clinician-governed clinical content (RAG library, disclaimer, first-aid, self-care). SC-6/SC-10.
CREATE TABLE IF NOT EXISTS public.health_triage_content_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('condition','first_aid','disclaimer','self_care','question')),
  language     text NOT NULL DEFAULT 'en',
  body         text NOT NULL,
  rag_tags     text[] NOT NULL DEFAULT '{}',
  state        text NOT NULL DEFAULT 'draft'
                 CHECK (state IN ('draft','clinical_review','approved','published','deprecated')),
  version      int NOT NULL DEFAULT 1,
  reviewer_id  uuid REFERENCES auth.users(id),
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, language, version)
);

-- CareReferral SM: created→routed(pharmacy|lab|telemed|emergency)→paid→fulfilled→follow_up→closed.
CREATE TABLE IF NOT EXISTS public.health_triage_care_referrals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES public.health_triage_sessions(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  disposition_level int,
  route             text NOT NULL CHECK (route IN ('pharmacy','lab','telemed','emergency','self_care')),
  target_ref        text,                              -- downstream order/booking id
  state             text NOT NULL DEFAULT 'created'
                      CHECK (state IN ('created','routed','paid','fulfilled','follow_up','closed')),
  amount_minor      bigint NOT NULL DEFAULT 0,
  payment_ref       text,
  idempotency_key   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_triage_referral_idem ON public.health_triage_care_referrals(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_triage_referral_user ON public.health_triage_care_referrals(user_id);

-- EscalationCase SM: raised→notified→acknowledged→resolved (human-in-loop, SC-5).
CREATE TABLE IF NOT EXISTS public.health_triage_escalations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES public.health_triage_sessions(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state       text NOT NULL DEFAULT 'raised'
                CHECK (state IN ('raised','notified','acknowledged','resolved')),
  reason      text,
  clinician_id uuid REFERENCES auth.users(id),
  raised_at   timestamptz NOT NULL DEFAULT now(),
  ack_at      timestamptz,
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_triage_escalations_state ON public.health_triage_escalations(state, raised_at);

-- Session report (→ records vault) + feedback.
CREATE TABLE IF NOT EXISTS public.health_triage_session_reports (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.health_triage_sessions(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  summary    jsonb NOT NULL DEFAULT '{}'::jsonb,
  vault_ref  text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.health_triage_feedback (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.health_triage_sessions(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating     int,
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Language packs (EN/Pidgin for Phase 1).
CREATE TABLE IF NOT EXISTS public.health_triage_language_packs (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code   text NOT NULL UNIQUE,
  name   text NOT NULL,
  status text NOT NULL DEFAULT 'active'
);

-- Validation harness: African clinical vignettes + shadow-mode eval runs (emergency sensitivity first).
CREATE TABLE IF NOT EXISTS public.health_triage_vignettes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,
  language           text NOT NULL DEFAULT 'en',
  evidence           jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_level     int NOT NULL,
  expected_emergency boolean NOT NULL DEFAULT false,
  expected_conditions text[] NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.health_triage_eval_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vignette_id       uuid NOT NULL REFERENCES public.health_triage_vignettes(id),
  engine_level      int,
  level_match       boolean NOT NULL DEFAULT false,
  emergency_correct boolean NOT NULL DEFAULT false,
  ran_at            timestamptz NOT NULL DEFAULT now()
);

-- Omnichannel mapping (WhatsApp/USSD external id → session).
CREATE TABLE IF NOT EXISTS public.health_triage_channel_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel     text NOT NULL,
  external_id text NOT NULL,
  session_id  uuid REFERENCES public.health_triage_sessions(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, external_id)
);

-- ── RLS ──
DO $$
DECLARE
  owner_tables text[] := ARRAY['health_triage_profiles','health_triage_consents','health_triage_sessions',
    'health_triage_intake','health_triage_evidence','health_triage_assessments','health_triage_red_flag_events',
    'health_triage_care_referrals','health_triage_escalations','health_triage_session_reports','health_triage_feedback'];
  public_read text[] := ARRAY['health_triage_content_items','health_triage_red_flag_rules','health_triage_language_packs'];
  admin_only  text[] := ARRAY['health_triage_vignettes','health_triage_eval_runs','health_triage_channel_sessions'];
  t text;
BEGIN
  FOREACH t IN ARRAY owner_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_owner ON public.%I', t, t);
    IF t IN ('health_triage_intake','health_triage_evidence','health_triage_assessments','health_triage_red_flag_events') THEN
      EXECUTE format('CREATE POLICY %I_owner ON public.%I FOR SELECT USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.health_triage_sessions s WHERE s.id = session_id AND s.user_id = auth.uid()))', t, t);
    ELSE
      EXECUTE format('CREATE POLICY %I_owner ON public.%I FOR SELECT USING (public.is_admin() OR user_id = auth.uid())', t, t);
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
  FOREACH t IN ARRAY public_read LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_read ON public.%I FOR SELECT USING (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
  FOREACH t IN ARRAY admin_only LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_admin ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_admin ON public.%I FOR SELECT USING (public.is_admin())', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
END $$;

-- ── RBAC ── clinician sign-off + ops. SC-5/SC-6.
INSERT INTO public.permissions (slug, description) VALUES
  ('health.triage.review','Review/sign-off triage clinical content + red-flag rules; handle escalations'),
  ('health.triage.admin','Administer the AI symptom checker (sessions, validation, config)')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE p.slug LIKE 'health.triage.%' AND r.slug IN ('super-admin','system-admin','health-admin')
ON CONFLICT DO NOTHING;

COMMIT;
