import type { SupabaseClient } from '@supabase/supabase-js';

import { ApiError } from '@/lib/api/responses';
import type {
  AcademyCandidateStage,
  AcademyEnrollmentInput,
  AcademyExamInput,
  AcademyExamQuestionInput,
  AcademyExamSubmissionInput,
  AcademyLessonInput,
  AcademyModuleInput,
  AcademyPracticalInvitationInput,
  AcademyPracticalSessionInput,
  AcademyProgramInput,
  AcademyStageOverrideInput,
} from '@/lib/validation/academy-lms';
import { createAdminClient } from '@/lib/supabase/server';

type EnrollmentRecord = {
  id: string;
  application_id: string | null;
  user_id: string | null;
  batch_id: string | null;
  program_id: string | null;
  current_stage: AcademyCandidateStage;
  manual_override: boolean;
  override_reason: string;
  online_completed_at: string | null;
  exam_eligible_at: string | null;
  exam_passed_at: string | null;
  practical_invited_at: string | null;
  practical_confirmed_at: string | null;
  practical_completed_at: string | null;
};

type LessonRecord = {
  id: string;
  module_id: string;
  title: string;
  description: string;
  content_markdown: string;
  video_url: string;
  resource_url: string;
  resource_label: string;
  order_index: number;
  estimated_minutes: number;
  is_required: boolean;
  is_published: boolean;
  academy_modules?: {
    id: string;
    title: string;
    description: string;
    order_index: number;
    program_id: string;
  } | null;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeAnswerList(value: string[]) {
  return [...value]
    .map((item) => item.trim())
    .filter(Boolean)
    .sort();
}

function answersMatch(expected: string[], received: string[]) {
  const normalizedExpected = normalizeAnswerList(expected);
  const normalizedReceived = normalizeAnswerList(received);

  if (normalizedExpected.length !== normalizedReceived.length) {
    return false;
  }

  return normalizedExpected.every((item, index) => item === normalizedReceived[index]);
}

async function insertAdminAuditLog(
  supabase: SupabaseClient,
  input: {
    adminId: string;
    actionType: string;
    targetTable: string;
    targetId?: string | null;
    reason?: string;
    oldValue?: Record<string, unknown>;
    newValue?: Record<string, unknown>;
  }
) {
  await supabase.from('admin_audit_logs').insert({
    admin_id: input.adminId,
    action_type: input.actionType,
    target_table: input.targetTable,
    target_id: input.targetId || null,
    old_value: input.oldValue || {},
    new_value: input.newValue || {},
    reason: input.reason || '',
  });
}

async function insertStageHistory(
  supabase: SupabaseClient,
  input: {
    enrollmentId?: string | null;
    applicationId?: string | null;
    oldStage?: AcademyCandidateStage | null;
    newStage: AcademyCandidateStage;
    changedBy?: string | null;
    reason?: string;
    source?: string;
  }
) {
  await supabase.from('academy_candidate_stage_history').insert({
    enrollment_id: input.enrollmentId || null,
    application_id: input.applicationId || null,
    old_stage: input.oldStage || null,
    new_stage: input.newStage,
    changed_by: input.changedBy || null,
    change_reason: input.reason || '',
    change_source: input.source || 'system',
  });
}

async function resolveUserIdByApplication(
  supabase: SupabaseClient,
  application: { user_id: string | null; email: string | null }
) {
  if (application.user_id) {
    return application.user_id;
  }

  if (!application.email) {
    return null;
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('email', application.email)
    .maybeSingle();

  return profile?.id || null;
}

async function getEnrollmentForUser(supabase: SupabaseClient, userId: string) {
  const { data: enrollment, error } = await supabase
    .from('academy_enrollments')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .maybeSingle();

  if (error) {
    throw new ApiError('Failed to load academy enrollment', 500);
  }

  return enrollment as EnrollmentRecord | null;
}

async function updateEnrollmentStage(
  supabase: SupabaseClient,
  enrollment: EnrollmentRecord,
  newStage: AcademyCandidateStage,
  input?: {
    changedBy?: string | null;
    reason?: string;
    source?: string;
    extra?: Record<string, unknown>;
  }
) {
  if (enrollment.current_stage === newStage && !input?.extra) {
    return enrollment;
  }

  await insertStageHistory(supabase, {
    enrollmentId: enrollment.id,
    applicationId: enrollment.application_id,
    oldStage: enrollment.current_stage,
    newStage,
    changedBy: input?.changedBy || null,
    reason: input?.reason,
    source: input?.source || 'system',
  });

  const { data, error } = await supabase
    .from('academy_enrollments')
    .update({
      current_stage: newStage,
      ...(input?.extra || {}),
    })
    .eq('id', enrollment.id)
    .select('*')
    .single();

  if (error || !data) {
    throw new ApiError('Failed to update academy stage', 500);
  }

  return data as EnrollmentRecord;
}

export async function getAcademyCandidateDashboard(userId: string, email: string | null) {
  const supabase = createAdminClient();

  const [
    { data: enrollmentRows, error: enrollmentError },
    { data: userApplicationRows, error: applicationError },
  ] = await Promise.all([
    supabase
      .from('academy_enrollments')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('academy_applications')
      .select('*, academy_batches(batch_name, start_date, training_schedule)')
      .or(email ? `user_id.eq.${userId},email.eq.${email}` : `user_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  if (enrollmentError || applicationError) {
    throw new ApiError('Failed to load academy dashboard', 500);
  }

  const enrollment = (enrollmentRows?.[0] || null) as EnrollmentRecord | null;
  const application = (userApplicationRows?.[0] || null) as Record<string, unknown> | null;

  let program: Record<string, unknown> | null = null;
  let modules: Array<Record<string, unknown>> = [];
  let lessonProgress: Array<Record<string, unknown>> = [];
  let exam: Record<string, unknown> | null = null;
  let latestAttempt: Record<string, unknown> | null = null;
  let practicalInvitation: Record<string, unknown> | null = null;
  let stageHistory: Array<Record<string, unknown>> = [];

  if (enrollment?.program_id) {
    const [programRes, modulesRes, progressRes, examRes, attemptRes, practicalRes, historyRes] =
      await Promise.all([
        supabase.from('academy_programs').select('*').eq('id', enrollment.program_id).maybeSingle(),
        supabase
          .from('academy_modules')
          .select('*, academy_lessons(*)')
          .eq('program_id', enrollment.program_id)
          .order('order_index', { ascending: true }),
        supabase
          .from('academy_lesson_progress')
          .select('*')
          .eq('enrollment_id', enrollment.id)
          .order('completed_at', { ascending: true }),
        supabase
          .from('academy_exams')
          .select('*')
          .eq('program_id', enrollment.program_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('academy_exam_attempts')
          .select('*')
          .eq('enrollment_id', enrollment.id)
          .order('attempt_number', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('academy_practical_invitations')
          .select('*, academy_practical_sessions(*)')
          .eq('enrollment_id', enrollment.id)
          .order('invited_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('academy_candidate_stage_history')
          .select('*')
          .eq('enrollment_id', enrollment.id)
          .order('created_at', { ascending: true }),
      ]);

    if (
      programRes.error ||
      modulesRes.error ||
      progressRes.error ||
      examRes.error ||
      attemptRes.error ||
      practicalRes.error ||
      historyRes.error
    ) {
      throw new ApiError('Failed to load academy learning data', 500);
    }

    program = programRes.data as Record<string, unknown> | null;
    modules = (modulesRes.data || []) as Array<Record<string, unknown>>;
    lessonProgress = (progressRes.data || []) as Array<Record<string, unknown>>;
    exam = examRes.data as Record<string, unknown> | null;
    latestAttempt = attemptRes.data as Record<string, unknown> | null;
    practicalInvitation = practicalRes.data as Record<string, unknown> | null;
    stageHistory = (historyRes.data || []) as Array<Record<string, unknown>>;
  }

  return {
    application,
    enrollment,
    program,
    modules,
    lessonProgress,
    exam,
    latestAttempt,
    practicalInvitation,
    stageHistory,
  };
}

export async function completeAcademyLesson(userId: string, lessonId: string) {
  const supabase = createAdminClient();
  const enrollment = await getEnrollmentForUser(supabase, userId);

  if (!enrollment || !enrollment.program_id) {
    throw new ApiError('You are not yet enrolled in the academy program', 403);
  }

  const { data: lesson, error: lessonError } = await supabase
    .from('academy_lessons')
    .select('*, academy_modules(id, title, description, order_index, program_id)')
    .eq('id', lessonId)
    .single();

  if (lessonError || !lesson) {
    throw new ApiError('Lesson not found', 404);
  }

  const lessonRecord = lesson as LessonRecord;

  if (lessonRecord.academy_modules?.program_id !== enrollment.program_id) {
    throw new ApiError('Lesson does not belong to your academy program', 403);
  }

  const { data: program, error: programError } = await supabase
    .from('academy_programs')
    .select('id, sequential_completion_required')
    .eq('id', enrollment.program_id)
    .single();

  if (programError || !program) {
    throw new ApiError('Program configuration not found', 404);
  }

  const { data: lessonsInProgram, error: lessonsError } = await supabase
    .from('academy_lessons')
    .select('id, order_index, is_required, academy_modules!inner(order_index, program_id)')
    .eq('academy_modules.program_id', enrollment.program_id)
    .eq('is_published', true)
    .order('order_index', { ascending: true });

  if (lessonsError) {
    throw new ApiError('Could not validate lesson progress', 500);
  }

  const normalizedLessons = (lessonsInProgram || [])
    .map((item) => ({
      id: item.id as string,
      order_index: item.order_index as number,
      is_required: item.is_required as boolean,
      module_order: Array.isArray(item.academy_modules)
        ? Number(item.academy_modules[0]?.order_index || 0)
        : Number((item.academy_modules as { order_index?: number } | null)?.order_index || 0),
    }))
    .sort((a, b) => a.module_order - b.module_order || a.order_index - b.order_index);

  const { data: existingProgress, error: progressError } = await supabase
    .from('academy_lesson_progress')
    .select('lesson_id, completed')
    .eq('enrollment_id', enrollment.id);

  if (progressError) {
    throw new ApiError('Could not validate lesson progress', 500);
  }

  const completedLessonIds = new Set(
    (existingProgress || [])
      .filter((item) => item.completed)
      .map((item) => item.lesson_id as string)
  );

  if (program.sequential_completion_required) {
    const lessonIndex = normalizedLessons.findIndex((item) => item.id === lessonId);
    const missingPrerequisite = normalizedLessons
      .slice(0, lessonIndex)
      .find((item) => item.is_required && !completedLessonIds.has(item.id));

    if (missingPrerequisite) {
      throw new ApiError('Complete earlier required lessons before unlocking this lesson', 400);
    }
  }

  const { error: upsertError } = await supabase.from('academy_lesson_progress').upsert(
    {
      enrollment_id: enrollment.id,
      lesson_id: lessonId,
      completed: true,
      completed_at: new Date().toISOString(),
    },
    { onConflict: 'enrollment_id,lesson_id' }
  );

  if (upsertError) {
    throw new ApiError('Failed to save lesson progress', 500);
  }

  const requiredLessonIds = normalizedLessons
    .filter((item) => item.is_required)
    .map((item) => item.id);
  const updatedCompletedLessonIds = new Set([...completedLessonIds, lessonId]);
  const allRequiredLessonsComplete = requiredLessonIds.every((id) =>
    updatedCompletedLessonIds.has(id)
  );

  let updatedEnrollment = enrollment;
  if (allRequiredLessonsComplete) {
    updatedEnrollment = await updateEnrollmentStage(supabase, enrollment, 'exam_eligible', {
      reason: 'All required online lessons completed',
      source: 'lesson_progress',
      extra: {
        online_completed_at: new Date().toISOString(),
        exam_eligible_at: new Date().toISOString(),
      },
    });

    await insertStageHistory(supabase, {
      enrollmentId: enrollment.id,
      applicationId: enrollment.application_id,
      oldStage: enrollment.current_stage,
      newStage: 'online_completed',
      reason: 'All required online lessons completed',
      source: 'lesson_progress',
    });
  } else if (['approved', 'enrolled', 'applied'].includes(enrollment.current_stage)) {
    updatedEnrollment = await updateEnrollmentStage(supabase, enrollment, 'online_in_progress', {
      reason: 'Candidate started the online learning phase',
      source: 'lesson_progress',
    });
  }

  return {
    success: true,
    enrollment: updatedEnrollment,
    all_required_lessons_complete: allRequiredLessonsComplete,
  };
}

export async function getCandidateExam(userId: string, examId: string) {
  const supabase = createAdminClient();
  const enrollment = await getEnrollmentForUser(supabase, userId);

  if (!enrollment || !enrollment.program_id) {
    throw new ApiError('You are not yet enrolled in the academy program', 403);
  }

  if (!['exam_eligible', 'exam_failed', 'exam_taken'].includes(enrollment.current_stage)) {
    throw new ApiError('You are not yet eligible to take the exam', 403);
  }

  const { data: exam, error: examError } = await supabase
    .from('academy_exams')
    .select('*')
    .eq('id', examId)
    .eq('program_id', enrollment.program_id)
    .eq('is_published', true)
    .single();

  if (examError || !exam) {
    throw new ApiError('Exam not found', 404);
  }

  const { data: attempts, error: attemptsError } = await supabase
    .from('academy_exam_attempts')
    .select('id')
    .eq('exam_id', examId)
    .eq('enrollment_id', enrollment.id);

  if (attemptsError) {
    throw new ApiError('Failed to load exam attempts', 500);
  }

  if (
    (attempts?.length || 0) >= Number(exam.max_attempts || 1) &&
    enrollment.current_stage !== 'exam_failed'
  ) {
    throw new ApiError('Maximum exam attempts reached', 400);
  }

  const { data: questions, error: questionsError } = await supabase
    .from('academy_exam_questions')
    .select('id, question_text, question_type, options, points, order_index, explanation')
    .eq('exam_id', examId)
    .eq('is_active', true)
    .order('order_index', { ascending: true });

  if (questionsError) {
    throw new ApiError('Failed to load exam questions', 500);
  }

  return {
    exam,
    questions: (questions || []).map((question) => ({
      ...question,
      explanation: '',
    })),
  };
}

export async function submitCandidateExam(
  userId: string,
  examId: string,
  input: AcademyExamSubmissionInput
) {
  const supabase = createAdminClient();
  const enrollment = await getEnrollmentForUser(supabase, userId);

  if (!enrollment || !enrollment.program_id) {
    throw new ApiError('You are not yet enrolled in the academy program', 403);
  }

  const [
    { data: exam, error: examError },
    { data: questions, error: questionsError },
    { count: existingAttemptsCount, error: attemptsError },
  ] = await Promise.all([
    supabase
      .from('academy_exams')
      .select('*')
      .eq('id', examId)
      .eq('program_id', enrollment.program_id)
      .single(),
    supabase
      .from('academy_exam_questions')
      .select('*')
      .eq('exam_id', examId)
      .eq('is_active', true)
      .order('order_index', { ascending: true }),
    supabase
      .from('academy_exam_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('exam_id', examId)
      .eq('enrollment_id', enrollment.id),
  ]);

  if (examError || !exam || questionsError || !questions || attemptsError) {
    throw new ApiError('Could not process the exam submission', 500);
  }

  if ((existingAttemptsCount || 0) >= Number(exam.max_attempts || 1)) {
    throw new ApiError('Maximum exam attempts reached', 400);
  }

  let score = 0;
  let totalPoints = 0;

  const normalizedQuestions = (questions || []) as Array<Record<string, unknown>>;
  normalizedQuestions.forEach((question) => {
    const points = Number(question.points || 1);
    totalPoints += points;
    const questionId = String(question.id);
    const candidateAnswer = input.answers[questionId] || [];
    const correctAnswer = getArrayOfStrings(question.correct_answer);

    if (answersMatch(correctAnswer, candidateAnswer)) {
      score += points;
    }
  });

  const percentage = totalPoints > 0 ? Number(((score / totalPoints) * 100).toFixed(2)) : 0;
  const passed = percentage >= Number(exam.pass_mark || 70);
  const submittedAt = new Date().toISOString();

  const { data: attempt, error: insertError } = await supabase
    .from('academy_exam_attempts')
    .insert({
      exam_id: examId,
      enrollment_id: enrollment.id,
      user_id: userId,
      attempt_number: (existingAttemptsCount || 0) + 1,
      status: 'graded',
      answers: input.answers,
      score,
      total_points: totalPoints,
      percentage,
      passed,
      submitted_at: submittedAt,
    })
    .select('*')
    .single();

  if (insertError || !attempt) {
    throw new ApiError('Failed to save exam attempt', 500);
  }

  await insertStageHistory(supabase, {
    enrollmentId: enrollment.id,
    applicationId: enrollment.application_id,
    oldStage: enrollment.current_stage,
    newStage: 'exam_taken',
    reason: 'Candidate submitted the online exam',
    source: 'exam',
  });

  const updatedEnrollment = await updateEnrollmentStage(
    supabase,
    enrollment,
    passed ? 'exam_passed' : 'exam_failed',
    {
      reason: passed ? 'Candidate passed the online exam' : 'Candidate did not meet the pass mark',
      source: 'exam',
      extra: passed ? { exam_passed_at: submittedAt } : {},
    }
  );

  return {
    attempt,
    passed,
    percentage,
    score,
    total_points: totalPoints,
    pass_mark: Number(exam.pass_mark || 70),
    enrollment: updatedEnrollment,
  };
}

function getArrayOfStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export async function confirmPracticalInvitation(userId: string, invitationId: string) {
  const supabase = createAdminClient();

  const { data: invitation, error } = await supabase
    .from('academy_practical_invitations')
    .select('*, academy_enrollments(*)')
    .eq('id', invitationId)
    .single();

  if (error || !invitation) {
    throw new ApiError('Practical invitation not found', 404);
  }

  const enrollment = invitation.academy_enrollments as EnrollmentRecord | null;

  if (!enrollment || enrollment.user_id !== userId) {
    throw new ApiError('You do not have access to this invitation', 403);
  }

  if (invitation.status === 'confirmed') {
    return { success: true, alreadyConfirmed: true };
  }

  const confirmedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('academy_practical_invitations')
    .update({ status: 'confirmed', confirmed_at: confirmedAt })
    .eq('id', invitationId);

  if (updateError) {
    throw new ApiError('Failed to confirm practical invitation', 500);
  }

  const updatedEnrollment = await updateEnrollmentStage(
    supabase,
    enrollment,
    'practical_confirmed',
    {
      reason: 'Candidate confirmed attendance for the practical class',
      source: 'practical_invitation',
      extra: { practical_confirmed_at: confirmedAt },
    }
  );

  return { success: true, enrollment: updatedEnrollment };
}

export async function getAcademyAdminLmsData() {
  const supabase = createAdminClient();

  const [
    { count: totalApplications, error: totalApplicationsError },
    { count: approvedApplications, error: approvedApplicationsError },
    { count: enrolledCandidates, error: enrolledCandidatesError },
    { count: onlineCompletedCount, error: onlineCompletedError },
    { data: examAttempts, error: examAttemptsError },
    { count: practicalInvitedCount, error: practicalInvitedError },
    { count: practicalConfirmedCount, error: practicalConfirmedError },
    { data: applications, error: applicationsError },
    { data: enrollments, error: enrollmentsError },
    { data: programs, error: programsError },
    { data: modules, error: modulesError },
    { data: lessons, error: lessonsError },
    { data: exams, error: examsError },
    { data: questions, error: questionsError },
    { data: practicalSessions, error: practicalSessionsError },
    { data: practicalInvitations, error: practicalInvitationsError },
  ] = await Promise.all([
    supabase.from('academy_applications').select('*', { count: 'exact', head: true }),
    supabase
      .from('academy_applications')
      .select('*', { count: 'exact', head: true })
      .in('status', ['approved', 'enrolled']),
    supabase.from('academy_enrollments').select('*', { count: 'exact', head: true }),
    supabase
      .from('academy_enrollments')
      .select('*', { count: 'exact', head: true })
      .in('current_stage', [
        'online_completed',
        'exam_eligible',
        'exam_taken',
        'exam_passed',
        'practical_invited',
        'practical_confirmed',
        'practical_completed',
      ]),
    supabase.from('academy_exam_attempts').select('passed'),
    supabase.from('academy_practical_invitations').select('*', { count: 'exact', head: true }),
    supabase
      .from('academy_practical_invitations')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'confirmed'),
    supabase
      .from('academy_applications')
      .select('id, full_name, email, status, batch_id, created_at, academy_batches(batch_name)'),
    supabase
      .from('academy_enrollments')
      .select('*, academy_programs(title), academy_applications(full_name, email, status)'),
    supabase.from('academy_programs').select('*').order('created_at', { ascending: false }),
    supabase.from('academy_modules').select('*').order('order_index', { ascending: true }),
    supabase.from('academy_lessons').select('*').order('order_index', { ascending: true }),
    supabase.from('academy_exams').select('*').order('created_at', { ascending: false }),
    supabase
      .from('academy_exam_questions')
      .select('id, exam_id, question_text, question_type, points, order_index, is_active')
      .order('order_index', { ascending: true }),
    supabase
      .from('academy_practical_sessions')
      .select('*')
      .order('session_date', { ascending: false }),
    supabase
      .from('academy_practical_invitations')
      .select(
        '*, academy_practical_sessions(title, session_date), academy_enrollments(current_stage, academy_applications(full_name, email))'
      )
      .order('invited_at', { ascending: false }),
  ]);

  if (
    totalApplicationsError ||
    approvedApplicationsError ||
    enrolledCandidatesError ||
    onlineCompletedError ||
    examAttemptsError ||
    practicalInvitedError ||
    practicalConfirmedError ||
    applicationsError ||
    enrollmentsError ||
    programsError ||
    modulesError ||
    lessonsError ||
    examsError ||
    questionsError ||
    practicalSessionsError ||
    practicalInvitationsError
  ) {
    throw new ApiError('Failed to load academy LMS admin data', 500);
  }

  const passCount = (examAttempts || []).filter((item) => item.passed === true).length;
  const failCount = (examAttempts || []).filter((item) => item.passed === false).length;

  return {
    stats: {
      total_applications: totalApplications || 0,
      approved_candidates: approvedApplications || 0,
      enrolled_candidates: enrolledCandidates || 0,
      online_completion_count: onlineCompletedCount || 0,
      exam_pass_count: passCount,
      exam_fail_count: failCount,
      practical_invited_count: practicalInvitedCount || 0,
      practical_confirmed_count: practicalConfirmedCount || 0,
    },
    applications: applications || [],
    enrollments: enrollments || [],
    programs: programs || [],
    modules: modules || [],
    lessons: lessons || [],
    exams: exams || [],
    questions: questions || [],
    practicalSessions: practicalSessions || [],
    practicalInvitations: practicalInvitations || [],
  };
}

export async function createAcademyProgram(adminId: string, input: AcademyProgramInput) {
  const supabase = createAdminClient();
  const slug = `${slugify(input.title)}-${Math.random().toString(36).slice(2, 8)}`;

  const { data, error } = await supabase
    .from('academy_programs')
    .insert({
      title: input.title,
      slug,
      description: input.description,
      batch_id: input.batch_id,
      sequential_completion_required: input.sequential_completion_required,
      estimated_duration_weeks: input.estimated_duration_weeks,
      is_published: input.is_published,
      created_by: adminId,
      updated_by: adminId,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new ApiError('Failed to create academy program', 500);
  }

  await insertAdminAuditLog(supabase, {
    adminId,
    actionType: 'create_academy_program',
    targetTable: 'academy_programs',
    targetId: data.id,
    newValue: data,
  });

  return data;
}

export async function createAcademyModule(adminId: string, input: AcademyModuleInput) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('academy_modules')
    .insert({
      program_id: input.program_id,
      title: input.title,
      description: input.description,
      order_index: input.order_index,
      is_published: input.is_published,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new ApiError('Failed to create academy module', 500);
  }

  await insertAdminAuditLog(supabase, {
    adminId,
    actionType: 'create_academy_module',
    targetTable: 'academy_modules',
    targetId: data.id,
    newValue: data,
  });

  return data;
}

export async function createAcademyLesson(adminId: string, input: AcademyLessonInput) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('academy_lessons')
    .insert({
      module_id: input.module_id,
      title: input.title,
      description: input.description,
      content_markdown: input.content_markdown,
      video_url: input.video_url,
      resource_url: input.resource_url,
      resource_label: input.resource_label,
      order_index: input.order_index,
      estimated_minutes: input.estimated_minutes,
      is_required: input.is_required,
      is_published: input.is_published,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new ApiError('Failed to create academy lesson', 500);
  }

  await insertAdminAuditLog(supabase, {
    adminId,
    actionType: 'create_academy_lesson',
    targetTable: 'academy_lessons',
    targetId: data.id,
    newValue: data,
  });

  return data;
}

export async function createAcademyExam(adminId: string, input: AcademyExamInput) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('academy_exams')
    .insert({
      program_id: input.program_id,
      title: input.title,
      description: input.description,
      pass_mark: input.pass_mark,
      time_limit_minutes: input.time_limit_minutes,
      max_attempts: input.max_attempts,
      is_published: input.is_published,
      created_by: adminId,
      updated_by: adminId,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new ApiError('Failed to create academy exam', 500);
  }

  await insertAdminAuditLog(supabase, {
    adminId,
    actionType: 'configure_academy_exam',
    targetTable: 'academy_exams',
    targetId: data.id,
    newValue: data,
  });

  return data;
}

export async function createAcademyQuestion(adminId: string, input: AcademyExamQuestionInput) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('academy_exam_questions')
    .insert({
      exam_id: input.exam_id,
      question_text: input.question_text,
      question_type: input.question_type,
      options: input.options,
      correct_answer: input.correct_answer,
      points: input.points,
      order_index: input.order_index,
      explanation: input.explanation,
      is_active: input.is_active,
    })
    .select('id, exam_id, question_text, question_type, points, order_index, is_active')
    .single();

  if (error || !data) {
    throw new ApiError('Failed to create exam question', 500);
  }

  await insertAdminAuditLog(supabase, {
    adminId,
    actionType: 'create_academy_exam_question',
    targetTable: 'academy_exam_questions',
    targetId: data.id,
    newValue: data,
  });

  return data;
}

export async function enrollAcademyCandidate(adminId: string, input: AcademyEnrollmentInput) {
  const supabase = createAdminClient();

  const { data: application, error: applicationError } = await supabase
    .from('academy_applications')
    .select('id, user_id, email, batch_id, status')
    .eq('id', input.application_id)
    .single();

  if (applicationError || !application) {
    throw new ApiError('Academy application not found', 404);
  }

  const resolvedUserId = await resolveUserIdByApplication(supabase, application);

  const { data: existingEnrollment } = await supabase
    .from('academy_enrollments')
    .select('*')
    .eq('application_id', input.application_id)
    .maybeSingle();

  let enrollment: EnrollmentRecord | null = null;

  if (existingEnrollment) {
    const { data, error } = await supabase
      .from('academy_enrollments')
      .update({
        user_id: resolvedUserId,
        batch_id: application.batch_id,
        program_id: input.program_id,
        current_stage: 'enrolled',
        manual_override: false,
        override_reason: '',
      })
      .eq('id', existingEnrollment.id)
      .select('*')
      .single();

    if (error || !data) {
      throw new ApiError('Failed to update academy enrollment', 500);
    }

    enrollment = data as EnrollmentRecord;
  } else {
    const { data, error } = await supabase
      .from('academy_enrollments')
      .insert({
        application_id: input.application_id,
        user_id: resolvedUserId,
        batch_id: application.batch_id,
        program_id: input.program_id,
        current_stage: 'enrolled',
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new ApiError('Failed to create academy enrollment', 500);
    }

    enrollment = data as EnrollmentRecord;
  }

  const { error: updateApplicationError } = await supabase
    .from('academy_applications')
    .update({
      status: 'enrolled',
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', input.application_id);

  if (updateApplicationError) {
    throw new ApiError('Failed to update application status for enrollment', 500);
  }

  await insertStageHistory(supabase, {
    enrollmentId: enrollment.id,
    applicationId: input.application_id,
    oldStage: existingEnrollment?.current_stage as AcademyCandidateStage | undefined,
    newStage: 'enrolled',
    changedBy: adminId,
    reason: 'Candidate enrolled by admin',
    source: 'admin_enrollment',
  });

  await insertAdminAuditLog(supabase, {
    adminId,
    actionType: 'enroll_academy_candidate',
    targetTable: 'academy_enrollments',
    targetId: enrollment.id,
    newValue: enrollment as unknown as Record<string, unknown>,
  });

  return enrollment;
}

export async function overrideAcademyCandidateStage(
  adminId: string,
  enrollmentId: string,
  input: AcademyStageOverrideInput
) {
  const supabase = createAdminClient();
  const { data: enrollment, error } = await supabase
    .from('academy_enrollments')
    .select('*')
    .eq('id', enrollmentId)
    .single();

  if (error || !enrollment) {
    throw new ApiError('Academy candidate record not found', 404);
  }

  const updatedEnrollment = await updateEnrollmentStage(
    supabase,
    enrollment as EnrollmentRecord,
    input.stage,
    {
      changedBy: adminId,
      reason: input.reason || 'Admin override',
      source: 'admin_override',
      extra: {
        manual_override: true,
        override_reason: input.reason || 'Admin override',
      },
    }
  );

  await insertAdminAuditLog(supabase, {
    adminId,
    actionType: 'override_academy_stage',
    targetTable: 'academy_enrollments',
    targetId: enrollmentId,
    oldValue: { current_stage: enrollment.current_stage },
    newValue: { current_stage: input.stage },
    reason: input.reason,
  });

  return updatedEnrollment;
}

export async function createAcademyPracticalSession(
  adminId: string,
  input: AcademyPracticalSessionInput
) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('academy_practical_sessions')
    .insert({
      program_id: input.program_id,
      batch_id: input.batch_id,
      title: input.title,
      venue: input.venue,
      address: input.address,
      session_date: input.session_date,
      start_time: input.start_time,
      instructions: input.instructions,
      capacity: input.capacity,
      created_by: adminId,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new ApiError('Failed to create practical session', 500);
  }

  await insertAdminAuditLog(supabase, {
    adminId,
    actionType: 'create_practical_session',
    targetTable: 'academy_practical_sessions',
    targetId: data.id,
    newValue: data,
  });

  return data;
}

export async function inviteCandidateToPractical(
  adminId: string,
  input: AcademyPracticalInvitationInput
) {
  const supabase = createAdminClient();

  const [{ data: enrollment, error: enrollmentError }, { data: session, error: sessionError }] =
    await Promise.all([
      supabase.from('academy_enrollments').select('*').eq('id', input.enrollment_id).single(),
      supabase.from('academy_practical_sessions').select('*').eq('id', input.session_id).single(),
    ]);

  if (enrollmentError || !enrollment || sessionError || !session) {
    throw new ApiError('Candidate or practical session not found', 404);
  }

  if (
    enrollment.current_stage !== 'exam_passed' &&
    enrollment.current_stage !== 'practical_invited'
  ) {
    throw new ApiError('Only exam-passed candidates can be invited to a practical session', 400);
  }

  const { data, error } = await supabase
    .from('academy_practical_invitations')
    .upsert(
      {
        session_id: input.session_id,
        enrollment_id: input.enrollment_id,
        candidate_user_id: enrollment.user_id,
        status: 'invited',
        created_by: adminId,
        notes: input.notes,
      },
      { onConflict: 'session_id,enrollment_id' }
    )
    .select('*')
    .single();

  if (error || !data) {
    throw new ApiError('Failed to create practical invitation', 500);
  }

  const updatedEnrollment = await updateEnrollmentStage(
    supabase,
    enrollment as EnrollmentRecord,
    'practical_invited',
    {
      changedBy: adminId,
      reason: 'Candidate invited to physical practical session',
      source: 'practical_invitation',
      extra: {
        practical_invited_at: new Date().toISOString(),
      },
    }
  );

  await insertAdminAuditLog(supabase, {
    adminId,
    actionType: 'invite_practical_candidate',
    targetTable: 'academy_practical_invitations',
    targetId: data.id,
    newValue: data,
  });

  return { invitation: data, enrollment: updatedEnrollment };
}
