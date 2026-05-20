-- ============================================================
-- Spotlight Film Academy Hybrid Learning MVP
-- Adds learning, exam, progress, and practical session workflows
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'academy_candidate_stage'
  ) THEN
    CREATE TYPE public.academy_candidate_stage AS ENUM (
      'applied',
      'approved',
      'enrolled',
      'online_in_progress',
      'online_completed',
      'exam_eligible',
      'exam_taken',
      'exam_passed',
      'exam_failed',
      'practical_invited',
      'practical_confirmed',
      'practical_completed'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'academy_question_type'
  ) THEN
    CREATE TYPE public.academy_question_type AS ENUM (
      'single_choice',
      'multiple_choice',
      'true_false'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'academy_exam_attempt_status'
  ) THEN
    CREATE TYPE public.academy_exam_attempt_status AS ENUM (
      'submitted',
      'graded'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'academy_practical_session_status'
  ) THEN
    CREATE TYPE public.academy_practical_session_status AS ENUM (
      'scheduled',
      'completed',
      'cancelled'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'academy_practical_invitation_status'
  ) THEN
    CREATE TYPE public.academy_practical_invitation_status AS ENUM (
      'invited',
      'confirmed',
      'declined',
      'attended'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.academy_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  batch_id UUID REFERENCES public.academy_batches(id) ON DELETE SET NULL,
  sequential_completion_required BOOLEAN NOT NULL DEFAULT true,
  estimated_duration_weeks INTEGER NOT NULL DEFAULT 12,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.academy_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES public.academy_programs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  order_index INTEGER NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.academy_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES public.academy_modules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content_markdown TEXT NOT NULL DEFAULT '',
  video_url TEXT NOT NULL DEFAULT '',
  resource_url TEXT NOT NULL DEFAULT '',
  resource_label TEXT NOT NULL DEFAULT '',
  order_index INTEGER NOT NULL DEFAULT 0,
  estimated_minutes INTEGER NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT true,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.academy_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID UNIQUE REFERENCES public.academy_applications(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  batch_id UUID REFERENCES public.academy_batches(id) ON DELETE SET NULL,
  program_id UUID REFERENCES public.academy_programs(id) ON DELETE SET NULL,
  current_stage public.academy_candidate_stage NOT NULL DEFAULT 'applied',
  manual_override BOOLEAN NOT NULL DEFAULT false,
  override_reason TEXT NOT NULL DEFAULT '',
  online_completed_at TIMESTAMPTZ,
  exam_eligible_at TIMESTAMPTZ,
  exam_passed_at TIMESTAMPTZ,
  practical_invited_at TIMESTAMPTZ,
  practical_confirmed_at TIMESTAMPTZ,
  practical_completed_at TIMESTAMPTZ,
  final_completion_status TEXT NOT NULL DEFAULT 'in_progress',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.academy_lesson_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES public.academy_enrollments(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES public.academy_lessons(id) ON DELETE CASCADE,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (enrollment_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS public.academy_exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES public.academy_programs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  pass_mark INTEGER NOT NULL DEFAULT 70,
  time_limit_minutes INTEGER NOT NULL DEFAULT 30,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (pass_mark >= 0 AND pass_mark <= 100),
  CHECK (time_limit_minutes > 0),
  CHECK (max_attempts > 0)
);

CREATE TABLE IF NOT EXISTS public.academy_exam_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES public.academy_exams(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type public.academy_question_type NOT NULL,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  correct_answer JSONB NOT NULL DEFAULT '[]'::jsonb,
  points INTEGER NOT NULL DEFAULT 1,
  order_index INTEGER NOT NULL DEFAULT 0,
  explanation TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (points > 0)
);

CREATE TABLE IF NOT EXISTS public.academy_exam_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES public.academy_exams(id) ON DELETE CASCADE,
  enrollment_id UUID NOT NULL REFERENCES public.academy_enrollments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  status public.academy_exam_attempt_status NOT NULL DEFAULT 'graded',
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  score INTEGER NOT NULL DEFAULT 0,
  total_points INTEGER NOT NULL DEFAULT 0,
  percentage NUMERIC(5, 2) NOT NULL DEFAULT 0,
  passed BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (attempt_number > 0)
);

CREATE TABLE IF NOT EXISTS public.academy_practical_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES public.academy_programs(id) ON DELETE SET NULL,
  batch_id UUID REFERENCES public.academy_batches(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  venue TEXT NOT NULL,
  address TEXT NOT NULL,
  session_date DATE NOT NULL,
  start_time TIME NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 0,
  status public.academy_practical_session_status NOT NULL DEFAULT 'scheduled',
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (capacity >= 0)
);

CREATE TABLE IF NOT EXISTS public.academy_practical_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.academy_practical_sessions(id) ON DELETE CASCADE,
  enrollment_id UUID NOT NULL REFERENCES public.academy_enrollments(id) ON DELETE CASCADE,
  candidate_user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  status public.academy_practical_invitation_status NOT NULL DEFAULT 'invited',
  invited_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE (session_id, enrollment_id)
);

CREATE TABLE IF NOT EXISTS public.academy_candidate_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID REFERENCES public.academy_enrollments(id) ON DELETE CASCADE,
  application_id UUID REFERENCES public.academy_applications(id) ON DELETE SET NULL,
  old_stage public.academy_candidate_stage,
  new_stage public.academy_candidate_stage NOT NULL,
  changed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  change_reason TEXT NOT NULL DEFAULT '',
  change_source TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_academy_programs_published ON public.academy_programs(is_published);
CREATE INDEX IF NOT EXISTS idx_academy_modules_program ON public.academy_modules(program_id);
CREATE INDEX IF NOT EXISTS idx_academy_lessons_module ON public.academy_lessons(module_id);
CREATE INDEX IF NOT EXISTS idx_academy_enrollments_user ON public.academy_enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_academy_enrollments_stage ON public.academy_enrollments(current_stage);
CREATE INDEX IF NOT EXISTS idx_academy_enrollments_program ON public.academy_enrollments(program_id);
CREATE INDEX IF NOT EXISTS idx_academy_lesson_progress_enrollment ON public.academy_lesson_progress(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_academy_exams_program ON public.academy_exams(program_id);
CREATE INDEX IF NOT EXISTS idx_academy_exam_questions_exam ON public.academy_exam_questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_academy_exam_attempts_enrollment ON public.academy_exam_attempts(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_academy_practical_sessions_program ON public.academy_practical_sessions(program_id);
CREATE INDEX IF NOT EXISTS idx_academy_practical_invitations_enrollment ON public.academy_practical_invitations(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_academy_candidate_stage_history_enrollment ON public.academy_candidate_stage_history(enrollment_id);

DROP TRIGGER IF EXISTS set_academy_programs_updated_at ON public.academy_programs;
CREATE TRIGGER set_academy_programs_updated_at
  BEFORE UPDATE ON public.academy_programs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_academy_modules_updated_at ON public.academy_modules;
CREATE TRIGGER set_academy_modules_updated_at
  BEFORE UPDATE ON public.academy_modules
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_academy_lessons_updated_at ON public.academy_lessons;
CREATE TRIGGER set_academy_lessons_updated_at
  BEFORE UPDATE ON public.academy_lessons
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_academy_enrollments_updated_at ON public.academy_enrollments;
CREATE TRIGGER set_academy_enrollments_updated_at
  BEFORE UPDATE ON public.academy_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_academy_lesson_progress_updated_at ON public.academy_lesson_progress;
CREATE TRIGGER set_academy_lesson_progress_updated_at
  BEFORE UPDATE ON public.academy_lesson_progress
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_academy_exams_updated_at ON public.academy_exams;
CREATE TRIGGER set_academy_exams_updated_at
  BEFORE UPDATE ON public.academy_exams
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_academy_exam_questions_updated_at ON public.academy_exam_questions;
CREATE TRIGGER set_academy_exam_questions_updated_at
  BEFORE UPDATE ON public.academy_exam_questions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_academy_practical_sessions_updated_at ON public.academy_practical_sessions;
CREATE TRIGGER set_academy_practical_sessions_updated_at
  BEFORE UPDATE ON public.academy_practical_sessions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.academy_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_exam_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_practical_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_practical_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_candidate_stage_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_academy_programs" ON public.academy_programs;
CREATE POLICY "authenticated_read_academy_programs"
ON public.academy_programs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_manage_academy_programs" ON public.academy_programs;
CREATE POLICY "admin_manage_academy_programs"
ON public.academy_programs FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "authenticated_read_academy_modules" ON public.academy_modules;
CREATE POLICY "authenticated_read_academy_modules"
ON public.academy_modules FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_manage_academy_modules" ON public.academy_modules;
CREATE POLICY "admin_manage_academy_modules"
ON public.academy_modules FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "authenticated_read_academy_lessons" ON public.academy_lessons;
CREATE POLICY "authenticated_read_academy_lessons"
ON public.academy_lessons FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_manage_academy_lessons" ON public.academy_lessons;
CREATE POLICY "admin_manage_academy_lessons"
ON public.academy_lessons FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "users_read_own_academy_enrollments" ON public.academy_enrollments;
CREATE POLICY "users_read_own_academy_enrollments"
ON public.academy_enrollments FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "admin_manage_academy_enrollments" ON public.academy_enrollments;
CREATE POLICY "admin_manage_academy_enrollments"
ON public.academy_enrollments FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "users_read_own_academy_lesson_progress" ON public.academy_lesson_progress;
CREATE POLICY "users_read_own_academy_lesson_progress"
ON public.academy_lesson_progress FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.academy_enrollments ae
    WHERE ae.id = enrollment_id AND (ae.user_id = auth.uid() OR public.is_admin())
  )
);

DROP POLICY IF EXISTS "admin_manage_academy_lesson_progress" ON public.academy_lesson_progress;
CREATE POLICY "admin_manage_academy_lesson_progress"
ON public.academy_lesson_progress FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "authenticated_read_academy_exams" ON public.academy_exams;
CREATE POLICY "authenticated_read_academy_exams"
ON public.academy_exams FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_manage_academy_exams" ON public.academy_exams;
CREATE POLICY "admin_manage_academy_exams"
ON public.academy_exams FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "authenticated_read_academy_exam_questions" ON public.academy_exam_questions;
CREATE POLICY "authenticated_read_academy_exam_questions"
ON public.academy_exam_questions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_manage_academy_exam_questions" ON public.academy_exam_questions;
CREATE POLICY "admin_manage_academy_exam_questions"
ON public.academy_exam_questions FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "users_read_own_academy_exam_attempts" ON public.academy_exam_attempts;
CREATE POLICY "users_read_own_academy_exam_attempts"
ON public.academy_exam_attempts FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.academy_enrollments ae
    WHERE ae.id = enrollment_id AND (ae.user_id = auth.uid() OR public.is_admin())
  )
);

DROP POLICY IF EXISTS "admin_manage_academy_exam_attempts" ON public.academy_exam_attempts;
CREATE POLICY "admin_manage_academy_exam_attempts"
ON public.academy_exam_attempts FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "authenticated_read_academy_practical_sessions" ON public.academy_practical_sessions;
CREATE POLICY "authenticated_read_academy_practical_sessions"
ON public.academy_practical_sessions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_manage_academy_practical_sessions" ON public.academy_practical_sessions;
CREATE POLICY "admin_manage_academy_practical_sessions"
ON public.academy_practical_sessions FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "users_read_own_academy_practical_invitations" ON public.academy_practical_invitations;
CREATE POLICY "users_read_own_academy_practical_invitations"
ON public.academy_practical_invitations FOR SELECT TO authenticated
USING (
  candidate_user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.academy_enrollments ae
    WHERE ae.id = enrollment_id AND (ae.user_id = auth.uid() OR public.is_admin())
  )
);

DROP POLICY IF EXISTS "admin_manage_academy_practical_invitations" ON public.academy_practical_invitations;
CREATE POLICY "admin_manage_academy_practical_invitations"
ON public.academy_practical_invitations FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "users_read_own_academy_stage_history" ON public.academy_candidate_stage_history;
CREATE POLICY "users_read_own_academy_stage_history"
ON public.academy_candidate_stage_history FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.academy_enrollments ae
    WHERE ae.id = enrollment_id AND (ae.user_id = auth.uid() OR public.is_admin())
  )
);

DROP POLICY IF EXISTS "admin_manage_academy_stage_history" ON public.academy_candidate_stage_history;
CREATE POLICY "admin_manage_academy_stage_history"
ON public.academy_candidate_stage_history FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

INSERT INTO storage.buckets (id, name, public)
VALUES ('academy-resources', 'academy-resources', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "public_read_academy_resources" ON storage.objects;
CREATE POLICY "public_read_academy_resources" ON storage.objects
  FOR SELECT USING (bucket_id = 'academy-resources');

DROP POLICY IF EXISTS "admin_upload_academy_resources" ON storage.objects;
CREATE POLICY "admin_upload_academy_resources" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'academy-resources' AND public.is_admin());

DROP POLICY IF EXISTS "admin_update_academy_resources" ON storage.objects;
CREATE POLICY "admin_update_academy_resources" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'academy-resources' AND public.is_admin())
  WITH CHECK (bucket_id = 'academy-resources' AND public.is_admin());

DROP POLICY IF EXISTS "admin_delete_academy_resources" ON storage.objects;
CREATE POLICY "admin_delete_academy_resources" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'academy-resources' AND public.is_admin());
