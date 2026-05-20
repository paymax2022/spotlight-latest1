-- Spotlight Film Academy Admin Operations Expansion

CREATE TABLE IF NOT EXISTS public.academy_admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_name TEXT,
  role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.academy_interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.academy_applications(id) ON DELETE CASCADE,
  program_id UUID REFERENCES public.academy_programs(id) ON DELETE SET NULL,
  interview_date DATE NOT NULL,
  interview_time TIME NOT NULL,
  interview_mode TEXT NOT NULL DEFAULT 'physical',
  interview_panel TEXT[] NOT NULL DEFAULT '{}',
  interview_link_or_location TEXT NOT NULL DEFAULT '',
  interview_status TEXT NOT NULL DEFAULT 'scheduled',
  interview_score NUMERIC(5,2),
  interview_notes TEXT,
  recommendation TEXT NOT NULL DEFAULT 're_interview',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.academy_class_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES public.academy_programs(id) ON DELETE SET NULL,
  batch_id UUID REFERENCES public.academy_batches(id) ON DELETE CASCADE,
  module_id UUID REFERENCES public.academy_modules(id) ON DELETE SET NULL,
  instructor_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  class_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  venue TEXT NOT NULL DEFAULT '',
  online_link TEXT NOT NULL DEFAULT '',
  class_type TEXT NOT NULL DEFAULT 'lecture',
  required_materials TEXT,
  attendance_required BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.academy_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES public.academy_enrollments(id) ON DELETE CASCADE,
  schedule_id UUID REFERENCES public.academy_class_schedules(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'present',
  notes TEXT,
  marked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(enrollment_id, schedule_id)
);

CREATE TABLE IF NOT EXISTS public.academy_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES public.academy_programs(id) ON DELETE SET NULL,
  batch_id UUID REFERENCES public.academy_batches(id) ON DELETE CASCADE,
  module_id UUID REFERENCES public.academy_modules(id) ON DELETE SET NULL,
  instructor_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date TIMESTAMPTZ,
  submission_format TEXT NOT NULL DEFAULT 'file_or_link',
  max_score INTEGER NOT NULL DEFAULT 100,
  rubric TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.academy_assignment_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.academy_assignments(id) ON DELETE CASCADE,
  enrollment_id UUID NOT NULL REFERENCES public.academy_enrollments(id) ON DELETE CASCADE,
  submission_link TEXT,
  submission_text TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  score NUMERIC(6,2),
  grade TEXT,
  feedback TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'submitted',
  UNIQUE(assignment_id, enrollment_id)
);

CREATE TABLE IF NOT EXISTS public.academy_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES public.academy_enrollments(id) ON DELETE CASCADE,
  certificate_number TEXT UNIQUE NOT NULL,
  student_name TEXT NOT NULL,
  program_name TEXT NOT NULL,
  batch_name TEXT,
  completion_date DATE,
  grade TEXT,
  qr_verification_code TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  issued_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.academy_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  target_role TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'in_app',
  status TEXT NOT NULL DEFAULT 'queued',
  related_entity_type TEXT,
  related_entity_id TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.academy_support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general_enquiry',
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  assigned_officer_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  message TEXT NOT NULL DEFAULT '',
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_academy_admin_audit_logs_created_at ON public.academy_admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_academy_interviews_application ON public.academy_interviews(application_id);
CREATE INDEX IF NOT EXISTS idx_academy_class_schedules_batch ON public.academy_class_schedules(batch_id);
CREATE INDEX IF NOT EXISTS idx_academy_attendance_enrollment ON public.academy_attendance(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_academy_assignments_batch ON public.academy_assignments(batch_id);
CREATE INDEX IF NOT EXISTS idx_academy_notifications_target ON public.academy_notifications(target_user_id);
CREATE INDEX IF NOT EXISTS idx_academy_support_tickets_status ON public.academy_support_tickets(status);

ALTER TABLE public.academy_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_class_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_assignment_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_manage_academy_interviews" ON public.academy_interviews;
CREATE POLICY "admin_manage_academy_interviews" ON public.academy_interviews
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_academy_class_schedules" ON public.academy_class_schedules;
CREATE POLICY "admin_manage_academy_class_schedules" ON public.academy_class_schedules
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_academy_attendance" ON public.academy_attendance;
CREATE POLICY "admin_manage_academy_attendance" ON public.academy_attendance
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_academy_assignments" ON public.academy_assignments;
CREATE POLICY "admin_manage_academy_assignments" ON public.academy_assignments
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_academy_assignment_submissions" ON public.academy_assignment_submissions;
CREATE POLICY "admin_manage_academy_assignment_submissions" ON public.academy_assignment_submissions
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_academy_certificates" ON public.academy_certificates;
CREATE POLICY "admin_manage_academy_certificates" ON public.academy_certificates
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_academy_notifications" ON public.academy_notifications;
CREATE POLICY "admin_manage_academy_notifications" ON public.academy_notifications
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_academy_support_tickets" ON public.academy_support_tickets;
CREATE POLICY "admin_manage_academy_support_tickets" ON public.academy_support_tickets
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_academy_audit_logs" ON public.academy_admin_audit_logs;
CREATE POLICY "admin_manage_academy_audit_logs" ON public.academy_admin_audit_logs
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
