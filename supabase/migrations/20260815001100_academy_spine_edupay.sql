-- Spotlight Academy — Phase 2 (curriculum spine + parent layer + EduPay v1).
-- Additive-only. Builds on Phase-0/1 academy tables. Reuses Paymax rails:
-- finance/va (virtual accounts) + ledger + payout for EduPay collection/disbursement
-- (no shadow ledger); guardian_links for the parent layer.
BEGIN;

-- ───────────────────────── Progression (adaptive paths) ──────────────────────
CREATE TABLE IF NOT EXISTS public.academy_learning_paths (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  class_id   uuid REFERENCES public.academy_classes(id),
  subject_id uuid NOT NULL REFERENCES public.academy_subjects(id),
  state      text NOT NULL DEFAULT 'active' CHECK (state IN ('active','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, subject_id)
);

CREATE TABLE IF NOT EXISTS public.academy_path_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path_id      uuid NOT NULL REFERENCES public.academy_learning_paths(id) ON DELETE CASCADE,
  objective_id uuid NOT NULL REFERENCES public.academy_learning_objectives(id),
  ordinal      int NOT NULL DEFAULT 0,
  state        text NOT NULL DEFAULT 'locked' CHECK (state IN ('locked','available','in_progress','done')),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (path_id, objective_id)
);
CREATE INDEX IF NOT EXISTS idx_academy_path_steps_path ON public.academy_path_steps(path_id, ordinal);

CREATE TABLE IF NOT EXISTS public.academy_practice_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind         text NOT NULL DEFAULT 'adaptive' CHECK (kind IN ('adaptive','drill')),
  objective_ids text[] NOT NULL DEFAULT '{}',
  state        text NOT NULL DEFAULT 'created' CHECK (state IN ('created','completed')),
  score        numeric,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_practice_user ON public.academy_practice_sessions(user_id, created_at);

CREATE TABLE IF NOT EXISTS public.academy_recommendations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  objective_id uuid REFERENCES public.academy_learning_objectives(id),
  reason       text,
  score        numeric NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_recos_user ON public.academy_recommendations(user_id, score);

CREATE TABLE IF NOT EXISTS public.academy_adaptive_config (
  key        text PRIMARY KEY,            -- mastery_threshold | reco_rules | path_rules
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── EduPay (fees, pots, disbursement) ──────────────────
CREATE TABLE IF NOT EXISTS public.academy_schools (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  code                 text UNIQUE,
  virtual_account_ref  text,              -- finance/va account for disbursement
  contact              text,
  status               text NOT NULL DEFAULT 'active',
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.academy_fee_schedules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES public.academy_schools(id),
  class_code   text,
  term         text,
  name         text NOT NULL,
  amount_minor bigint NOT NULL DEFAULT 0,
  currency     text NOT NULL DEFAULT 'NGN',
  due_date     date,
  status       text NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.academy_edupay_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- payer/parent
  school_id     uuid NOT NULL REFERENCES public.academy_schools(id),
  student_name  text NOT NULL,
  student_class text,
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, school_id, student_name)
);

CREATE TABLE IF NOT EXISTS public.academy_savings_pots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_name        text NOT NULL,
  target_minor     bigint NOT NULL DEFAULT 0,
  saved_minor      bigint NOT NULL DEFAULT 0,   -- derived = SUM(contributions)
  fee_schedule_id  uuid REFERENCES public.academy_fee_schedules(id),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.academy_pot_contributions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pot_id          uuid NOT NULL REFERENCES public.academy_savings_pots(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_minor    bigint NOT NULL,
  wallet_ref      text,
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()  -- append-only
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_academy_pot_contrib_idem ON public.academy_pot_contributions(idempotency_key);

CREATE TABLE IF NOT EXISTS public.academy_disbursements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_schedule_id uuid REFERENCES public.academy_fee_schedules(id),
  school_id       uuid NOT NULL REFERENCES public.academy_schools(id),
  payer_user_id   uuid NOT NULL REFERENCES auth.users(id),
  student_ref     text,
  amount_minor    bigint NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'NGN',
  state           text NOT NULL DEFAULT 'fee_due'
                    CHECK (state IN ('fee_due','funding','collected','disbursed','reconciled')),
  source          text NOT NULL DEFAULT 'pay' CHECK (source IN ('pay','bnpl','pot','scholarship')),
  payment_ref     text,
  payout_ref      text,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  reconciled_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_academy_disb_idem ON public.academy_disbursements(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_academy_disb_payer ON public.academy_disbursements(payer_user_id, created_at);

CREATE TABLE IF NOT EXISTS public.academy_scholarships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id    uuid REFERENCES public.academy_sponsors(id),
  name          text NOT NULL,
  criteria      jsonb NOT NULL DEFAULT '{}'::jsonb,
  budget_minor  bigint NOT NULL DEFAULT 0,
  awarded_minor bigint NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.academy_scholarship_awards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scholarship_id  uuid NOT NULL REFERENCES public.academy_scholarships(id),
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  fee_schedule_id uuid REFERENCES public.academy_fee_schedules(id),
  amount_minor    bigint NOT NULL DEFAULT 0,
  state           text NOT NULL DEFAULT 'granted' CHECK (state IN ('granted','disbursed','revoked')),
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_academy_scholaward_idem ON public.academy_scholarship_awards(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ───────────────────────── Content production + localization ──────────────────
CREATE TABLE IF NOT EXISTS public.academy_content_productions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id  uuid REFERENCES public.academy_lessons(id),
  title      text NOT NULL,
  stage      text NOT NULL DEFAULT 'script'
               CHECK (stage IN ('script','storyboard','shoot','edit','qa','publish')),
  owner_id   uuid,
  sla_due    date,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','blocked')),
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_content_prod_stage ON public.academy_content_productions(stage, status);

CREATE TABLE IF NOT EXISTS public.academy_localizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,              -- lesson | subject | topic | ui
  entity_id   text NOT NULL,
  lang        text NOT NULL,              -- en | ha | yo | ig | ...
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'draft',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, lang)
);

-- ───────────────────────── Parent layer ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.academy_parent_controls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  minor_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  screen_time_minutes int NOT NULL DEFAULT 0,   -- 0 = unlimited
  allowed_hours     jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_max_age   int,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guardian_user_id, minor_user_id)
);

CREATE TABLE IF NOT EXISTS public.academy_progress_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  minor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period        text NOT NULL,            -- weekly | termly | YYYY-Www
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_reports_minor ON public.academy_progress_reports(minor_user_id, generated_at);

CREATE TABLE IF NOT EXISTS public.academy_purchase_approvals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES public.academy_orders(id) ON DELETE CASCADE,
  guardian_user_id uuid NOT NULL REFERENCES auth.users(id),
  minor_user_id    uuid NOT NULL REFERENCES auth.users(id),
  state            text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected')),
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_approvals_guardian ON public.academy_purchase_approvals(guardian_user_id, state);

CREATE TABLE IF NOT EXISTS public.academy_notification_templates (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key     text NOT NULL UNIQUE,
  channel text NOT NULL CHECK (channel IN ('push','sms','in_app','email')),
  title   text,
  body    text NOT NULL,
  status  text NOT NULL DEFAULT 'active'
);

-- ───────────────────────── RLS ───────────────────────────────────────────────
DO $$
DECLARE
  owner_tables text[] := ARRAY[
    'academy_learning_paths','academy_practice_sessions','academy_recommendations',
    'academy_edupay_accounts','academy_savings_pots','academy_pot_contributions',
    'academy_disbursements','academy_scholarship_awards','academy_progress_reports'];
  admin_tables text[] := ARRAY[
    'academy_path_steps','academy_adaptive_config','academy_schools','academy_fee_schedules',
    'academy_scholarships','academy_content_productions','academy_localizations','academy_notification_templates'];
  guardian_tables text[] := ARRAY['academy_parent_controls','academy_purchase_approvals'];
  t text;
BEGIN
  FOREACH t IN ARRAY owner_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_owner ON public.%I', t, t);
    IF t = 'academy_progress_reports' THEN
      EXECUTE format('CREATE POLICY %I_owner ON public.%I FOR SELECT USING (public.is_admin() OR minor_user_id = auth.uid())', t, t);
    ELSIF t = 'academy_disbursements' THEN
      EXECUTE format('CREATE POLICY %I_owner ON public.%I FOR SELECT USING (public.is_admin() OR payer_user_id = auth.uid())', t, t);
    ELSE
      EXECUTE format('CREATE POLICY %I_owner ON public.%I FOR SELECT USING (public.is_admin() OR user_id = auth.uid())', t, t);
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
  FOREACH t IN ARRAY admin_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_read ON public.%I FOR SELECT USING (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
  FOREACH t IN ARRAY guardian_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_owner ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_owner ON public.%I FOR SELECT USING (public.is_admin() OR guardian_user_id = auth.uid() OR minor_user_id = auth.uid())', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
END $$;

-- ───────────────────────── RBAC ──────────────────────────────────────────────
INSERT INTO public.permissions (slug, description) VALUES
  ('academy.edupay','Manage schools, fee schedules, disbursements + scholarships'),
  ('academy.notifications','Manage academy notification templates + messaging')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE p.slug IN ('academy.edupay','academy.notifications') AND r.slug IN ('super-admin','system-admin')
ON CONFLICT DO NOTHING;

COMMIT;
