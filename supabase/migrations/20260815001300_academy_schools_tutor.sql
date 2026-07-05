-- Spotlight Academy — Phase 4 (scale & B2B2C: institutions + tutor marketplace).
-- Additive-only. Reuses Paymax rails: finance/va (institution billing/licences),
-- payout (tutor earnings), kyc (tutor verification). NABTEB arena + ECCE classes
-- need no schema change (already permitted by existing CHECKs) — seeded as data.
BEGIN;

-- ───────────────────────── Institutions (B2B2C) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.academy_institutions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  type                text NOT NULL DEFAULT 'school' CHECK (type IN ('school','institution')),
  admin_user_id       uuid REFERENCES auth.users(id),
  white_label         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- logo/colors/domain
  virtual_account_ref text,                                  -- finance/va billing account
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.academy_licences (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.academy_institutions(id) ON DELETE CASCADE,
  tier           text NOT NULL,
  seats          int NOT NULL DEFAULT 0,
  used_seats     int NOT NULL DEFAULT 0,
  price_minor    bigint NOT NULL DEFAULT 0,
  starts_at      date,
  expires_at     date,
  state          text NOT NULL DEFAULT 'active' CHECK (state IN ('active','suspended','expired')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_licences_inst ON public.academy_licences(institution_id);

CREATE TABLE IF NOT EXISTS public.academy_class_groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  uuid NOT NULL REFERENCES public.academy_institutions(id) ON DELETE CASCADE,
  name            text NOT NULL,
  class_code      text,
  teacher_user_id uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.academy_enrollments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  uuid NOT NULL REFERENCES public.academy_institutions(id) ON DELETE CASCADE,
  class_group_id  uuid REFERENCES public.academy_class_groups(id),
  learner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state           text NOT NULL DEFAULT 'invited' CHECK (state IN ('invited','active','removed')),
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, learner_user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_academy_enroll_idem ON public.academy_enrollments(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_academy_enroll_learner ON public.academy_enrollments(learner_user_id);

CREATE TABLE IF NOT EXISTS public.academy_institution_billing (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.academy_institutions(id) ON DELETE CASCADE,
  period         text NOT NULL,
  amount_minor   bigint NOT NULL DEFAULT 0,
  state          text NOT NULL DEFAULT 'open' CHECK (state IN ('open','invoiced','paid','void')),
  payment_ref    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Tutor marketplace ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.academy_tutors (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  bio                text,
  subjects           text[] NOT NULL DEFAULT '{}',
  rating             numeric NOT NULL DEFAULT 0,
  review_count       int NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','suspended')),
  kyc_state          text NOT NULL DEFAULT 'unsubmitted',
  payout_account_ref text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.academy_tutor_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id       uuid NOT NULL REFERENCES public.academy_tutors(id) ON DELETE CASCADE,
  class_group_id uuid REFERENCES public.academy_class_groups(id),
  learner_id     uuid REFERENCES auth.users(id),
  kind           text NOT NULL DEFAULT 'homework' CHECK (kind IN ('lesson','homework','assessment')),
  content_ref    text,
  title          text NOT NULL,
  due_at         timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.academy_tutor_grades (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.academy_tutor_assignments(id) ON DELETE CASCADE,
  learner_id    uuid NOT NULL REFERENCES auth.users(id),
  score         numeric,
  feedback      text,
  state         text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','graded')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  graded_at     timestamptz
);

CREATE TABLE IF NOT EXISTS public.academy_tutor_earnings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id   uuid NOT NULL REFERENCES public.academy_tutors(id) ON DELETE CASCADE,
  source     text NOT NULL CHECK (source IN ('consult','class','assignment')),
  ref_id     text,
  amount_minor bigint NOT NULL DEFAULT 0,
  state      text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','paid','reversed')),
  ledger_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_tutor_earn ON public.academy_tutor_earnings(tutor_id, state);

CREATE TABLE IF NOT EXISTS public.academy_tutor_payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id        uuid NOT NULL REFERENCES public.academy_tutors(id) ON DELETE CASCADE,
  amount_minor    bigint NOT NULL DEFAULT 0,
  state           text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','paid','failed')),
  payout_ref      text,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_academy_tutor_payout_idem ON public.academy_tutor_payouts(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ───────────────────────── RLS ───────────────────────────────────────────────
DO $$
DECLARE
  public_read text[] := ARRAY['academy_tutors'];
  admin_only  text[] := ARRAY['academy_institutions','academy_licences','academy_class_groups',
    'academy_enrollments','academy_institution_billing','academy_tutor_assignments','academy_tutor_grades',
    'academy_tutor_earnings','academy_tutor_payouts'];
  t text;
BEGIN
  FOREACH t IN ARRAY public_read LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_read ON public.%I FOR SELECT USING (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
  FOREACH t IN ARRAY admin_only LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    -- owner-visible where a user column exists; admins always; service_role writes.
    IF t = 'academy_enrollments' THEN
      EXECUTE format('CREATE POLICY %I_read ON public.%I FOR SELECT USING (public.is_admin() OR learner_user_id = auth.uid())', t, t);
    ELSIF t = 'academy_tutor_grades' THEN
      EXECUTE format('CREATE POLICY %I_read ON public.%I FOR SELECT USING (public.is_admin() OR learner_id = auth.uid())', t, t);
    ELSE
      EXECUTE format('CREATE POLICY %I_read ON public.%I FOR SELECT USING (public.is_admin())', t, t);
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
END $$;

-- ───────────────────────── RBAC ──────────────────────────────────────────────
INSERT INTO public.permissions (slug, description) VALUES
  ('academy.schools','Manage B2B2C institutions, licences, enrolment + billing'),
  ('academy.tutor','Manage tutor marketplace: vetting, assignments, payouts')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE p.slug IN ('academy.schools','academy.tutor') AND r.slug IN ('super-admin','system-admin')
ON CONFLICT DO NOTHING;

COMMIT;
