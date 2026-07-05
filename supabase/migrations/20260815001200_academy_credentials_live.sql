-- Spotlight Academy — Phase 3 (learn-to-earn moat: trade → credentials →
-- Paymax earning roles; live + community + moderation). Additive-only.
-- Reuses: connect/live (LiveKit) for rooms; services.RBACService.AssignRoleToUser
-- for the earning-bridge role-upgrade; academy_trade_tracks (Phase 0).
BEGIN;

-- ───────────────────────── Credentials + verification registry ───────────────
CREATE TABLE IF NOT EXISTS public.academy_credentials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('academic','trade')),
  title           text NOT NULL,
  trade_track     text,
  subject_id      uuid REFERENCES public.academy_subjects(id),
  verification_id text NOT NULL UNIQUE,        -- public, shareable id (QR/verify)
  signature       text,                        -- detached signature over the claim
  state           text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','issued','revoked')),
  reason          text,
  issued_at       timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_credentials_user ON public.academy_credentials(user_id);

-- Public verification registry (no PII beyond holder display name + claim).
CREATE TABLE IF NOT EXISTS public.academy_credential_verifications (
  verification_id text PRIMARY KEY,
  credential_id   uuid NOT NULL REFERENCES public.academy_credentials(id) ON DELETE CASCADE,
  holder_name     text,
  title           text NOT NULL,
  kind            text NOT NULL,
  status          text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','revoked')),
  issued_at       timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Earning bridge ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.academy_earning_opportunities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE,
  title             text NOT NULL,
  role              text NOT NULL,             -- driver|agent|creator|merchant|service_provider
  eligibility_rules jsonb NOT NULL DEFAULT '{}'::jsonb, -- e.g. {trade_track, min_credentials}
  description       text,
  status            text NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.academy_earning_applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opportunity_id  uuid NOT NULL REFERENCES public.academy_earning_opportunities(id),
  state           text NOT NULL DEFAULT 'submitted'
                    CHECK (state IN ('submitted','routed','approved','rejected')),
  paymax_ref      text,                        -- role-upgrade/KYC reference
  reason          text,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_academy_earnapp_idem ON public.academy_earning_applications(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_academy_earnapp_user ON public.academy_earning_applications(user_id);

-- ───────────────────────── Trade tracks (the moat) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.academy_trade_modules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_track text NOT NULL,
  title       text NOT NULL,
  ordinal     int NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS public.academy_trade_lessons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id  uuid NOT NULL REFERENCES public.academy_trade_modules(id) ON DELETE CASCADE,
  title      text NOT NULL,
  type       text NOT NULL DEFAULT 'video',
  media_ref  text,
  transcript text,
  ordinal    int NOT NULL DEFAULT 0,
  status     text NOT NULL DEFAULT 'draft'
);
CREATE TABLE IF NOT EXISTS public.academy_trade_projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id  uuid NOT NULL REFERENCES public.academy_trade_modules(id) ON DELETE CASCADE,
  title      text NOT NULL,
  rubric     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ordinal    int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS public.academy_project_submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES public.academy_trade_projects(id),
  files        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- signed-URL refs (no blobs)
  state        text NOT NULL DEFAULT 'submitted' CHECK (state IN ('submitted','reviewed','passed','failed')),
  rubric_score numeric,
  reviewer_id  uuid,
  feedback     text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_academy_proj_sub_user ON public.academy_project_submissions(user_id);

CREATE TABLE IF NOT EXISTS public.academy_skill_assessments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_track     text NOT NULL,
  title           text NOT NULL,
  rubric          jsonb NOT NULL DEFAULT '{}'::jsonb,
  pass_threshold  numeric NOT NULL DEFAULT 0.7,
  credential_title text NOT NULL,
  status          text NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS public.academy_skill_attempts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL REFERENCES public.academy_skill_assessments(id),
  score         numeric,
  passed        boolean NOT NULL DEFAULT false,
  state         text NOT NULL DEFAULT 'created' CHECK (state IN ('created','graded')),
  credential_id uuid REFERENCES public.academy_credentials(id),
  idempotency_key text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_academy_skillattempt_idem ON public.academy_skill_attempts(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.academy_mentors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_track text,
  bio         text,
  status      text NOT NULL DEFAULT 'active',
  UNIQUE (user_id, trade_track)
);
CREATE TABLE IF NOT EXISTS public.academy_mentor_matches (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mentor_id  uuid NOT NULL REFERENCES public.academy_mentors(id),
  state      text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','active','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Live + community + moderation ─────────────────────
CREATE TABLE IF NOT EXISTS public.academy_live_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id      uuid NOT NULL REFERENCES auth.users(id),
  title        text NOT NULL,
  trade_track  text,
  subject_id   uuid REFERENCES public.academy_subjects(id),
  scheduled_at timestamptz,
  state        text NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled','live','ended','cancelled')),
  room_ref     text,                        -- LiveKit room
  replay_ref   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_live_sched ON public.academy_live_sessions(scheduled_at);

CREATE TABLE IF NOT EXISTS public.academy_live_participants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.academy_live_sessions(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'attendee' CHECK (role IN ('host','attendee')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  left_at    timestamptz,
  UNIQUE (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.academy_study_groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  scope      text,
  scope_ref  text,
  owner_id   uuid NOT NULL REFERENCES auth.users(id),
  goal       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.academy_group_members (
  group_id  uuid NOT NULL REFERENCES public.academy_study_groups(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.academy_discussions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope      text NOT NULL,                 -- subject | group | session
  ref_id     text NOT NULL,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body       text NOT NULL,
  parent_id  uuid REFERENCES public.academy_discussions(id),
  state      text NOT NULL DEFAULT 'visible' CHECK (state IN ('visible','hidden')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_disc_scope ON public.academy_discussions(scope, ref_id, created_at);

CREATE TABLE IF NOT EXISTS public.academy_moderation_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  text NOT NULL,               -- discussion | live | submission | profile
  entity_id    text NOT NULL,
  reporter_id  uuid REFERENCES auth.users(id),
  reason       text NOT NULL,
  state        text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','actioned','dismissed')),
  action       text,                        -- hidden | warned | banned | none
  moderator_id uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_academy_modreports_state ON public.academy_moderation_reports(state, created_at);

-- ───────────────────────── RLS ───────────────────────────────────────────────
DO $$
DECLARE
  owner_tables text[] := ARRAY['academy_credentials','academy_earning_applications',
    'academy_project_submissions','academy_skill_attempts','academy_mentor_matches'];
  public_read text[] := ARRAY['academy_credential_verifications','academy_earning_opportunities',
    'academy_trade_modules','academy_trade_lessons','academy_trade_projects','academy_skill_assessments',
    'academy_mentors','academy_live_sessions','academy_study_groups','academy_discussions'];
  admin_only text[] := ARRAY['academy_moderation_reports','academy_live_participants','academy_group_members'];
  t text;
BEGIN
  FOREACH t IN ARRAY owner_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_owner ON public.%I', t, t);
    IF t = 'academy_mentor_matches' THEN
      EXECUTE format('CREATE POLICY %I_owner ON public.%I FOR SELECT USING (public.is_admin() OR learner_id = auth.uid())', t, t);
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

-- ───────────────────────── RBAC ──────────────────────────────────────────────
INSERT INTO public.permissions (slug, description) VALUES
  ('academy.credentials','Issue/revoke credentials + manage earning-bridge opportunities'),
  ('academy.live','Manage live classes/events + replays')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE p.slug IN ('academy.credentials','academy.live') AND r.slug IN ('super-admin','system-admin')
ON CONFLICT DO NOTHING;

COMMIT;
