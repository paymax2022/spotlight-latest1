import { ApiError } from '@/lib/api/responses';

export const ACADEMY_CANDIDATE_STAGES = [
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
  'practical_completed',
] as const;

export type AcademyCandidateStage = (typeof ACADEMY_CANDIDATE_STAGES)[number];

export type AcademyProgramInput = {
  title: string;
  description: string;
  batch_id: string | null;
  sequential_completion_required: boolean;
  estimated_duration_weeks: number;
  is_published: boolean;
};

export type AcademyModuleInput = {
  program_id: string;
  title: string;
  description: string;
  order_index: number;
  is_published: boolean;
};

export type AcademyLessonInput = {
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
};

export type AcademyExamInput = {
  program_id: string;
  title: string;
  description: string;
  pass_mark: number;
  time_limit_minutes: number;
  max_attempts: number;
  is_published: boolean;
};

export type AcademyExamQuestionInput = {
  exam_id: string;
  question_text: string;
  question_type: 'single_choice' | 'multiple_choice' | 'true_false';
  options: string[];
  correct_answer: string[];
  points: number;
  order_index: number;
  explanation: string;
  is_active: boolean;
};

export type AcademyEnrollmentInput = {
  application_id: string;
  program_id: string;
};

export type AcademyStageOverrideInput = {
  stage: AcademyCandidateStage;
  reason: string;
};

export type AcademyExamSubmissionInput = {
  answers: Record<string, string[]>;
};

export type AcademyPracticalSessionInput = {
  program_id: string | null;
  batch_id: string | null;
  title: string;
  venue: string;
  address: string;
  session_date: string;
  start_time: string;
  instructions: string;
  capacity: number;
};

export type AcademyPracticalInvitationInput = {
  session_id: string;
  enrollment_id: string;
  notes: string;
};

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getOptionalString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function getNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function getStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim());
}

function getObject(body: unknown) {
  if (!body || typeof body !== 'object') {
    throw new ApiError('Invalid request body', 400);
  }

  return body as Record<string, unknown>;
}

export function parseAcademyProgramInput(body: unknown): AcademyProgramInput {
  const source = getObject(body);
  const title = getString(source.title);
  const estimatedDurationWeeks = getNumber(source.estimated_duration_weeks);

  if (!title) {
    throw new ApiError('Program title is required', 400);
  }

  if (!Number.isFinite(estimatedDurationWeeks) || estimatedDurationWeeks <= 0) {
    throw new ApiError('Estimated duration must be greater than zero', 400);
  }

  return {
    title,
    description: getOptionalString(source.description),
    batch_id: getOptionalString(source.batch_id) || null,
    sequential_completion_required: getBoolean(source.sequential_completion_required, true),
    estimated_duration_weeks: Math.trunc(estimatedDurationWeeks),
    is_published: getBoolean(source.is_published, false),
  };
}

export function parseAcademyModuleInput(body: unknown): AcademyModuleInput {
  const source = getObject(body);
  const title = getString(source.title);
  const programId = getString(source.program_id);
  const orderIndex = getNumber(source.order_index);

  if (!programId) {
    throw new ApiError('Program is required', 400);
  }

  if (!title) {
    throw new ApiError('Module title is required', 400);
  }

  if (!Number.isFinite(orderIndex) || orderIndex < 0) {
    throw new ApiError('Module order must be zero or greater', 400);
  }

  return {
    program_id: programId,
    title,
    description: getOptionalString(source.description),
    order_index: Math.trunc(orderIndex),
    is_published: getBoolean(source.is_published, false),
  };
}

export function parseAcademyLessonInput(body: unknown): AcademyLessonInput {
  const source = getObject(body);
  const moduleId = getString(source.module_id);
  const title = getString(source.title);
  const orderIndex = getNumber(source.order_index);
  const estimatedMinutes = getNumber(source.estimated_minutes);

  if (!moduleId) {
    throw new ApiError('Module is required', 400);
  }

  if (!title) {
    throw new ApiError('Lesson title is required', 400);
  }

  if (!Number.isFinite(orderIndex) || orderIndex < 0) {
    throw new ApiError('Lesson order must be zero or greater', 400);
  }

  if (!Number.isFinite(estimatedMinutes) || estimatedMinutes < 0) {
    throw new ApiError('Estimated minutes must be zero or greater', 400);
  }

  return {
    module_id: moduleId,
    title,
    description: getOptionalString(source.description),
    content_markdown: getOptionalString(source.content_markdown),
    video_url: getOptionalString(source.video_url),
    resource_url: getOptionalString(source.resource_url),
    resource_label: getOptionalString(source.resource_label),
    order_index: Math.trunc(orderIndex),
    estimated_minutes: Math.trunc(estimatedMinutes),
    is_required: getBoolean(source.is_required, true),
    is_published: getBoolean(source.is_published, false),
  };
}

export function parseAcademyExamInput(body: unknown): AcademyExamInput {
  const source = getObject(body);
  const programId = getString(source.program_id);
  const title = getString(source.title);
  const passMark = getNumber(source.pass_mark);
  const timeLimitMinutes = getNumber(source.time_limit_minutes);
  const maxAttempts = getNumber(source.max_attempts);

  if (!programId) {
    throw new ApiError('Program is required', 400);
  }

  if (!title) {
    throw new ApiError('Exam title is required', 400);
  }

  if (!Number.isFinite(passMark) || passMark < 0 || passMark > 100) {
    throw new ApiError('Pass mark must be between 0 and 100', 400);
  }

  if (!Number.isFinite(timeLimitMinutes) || timeLimitMinutes <= 0) {
    throw new ApiError('Time limit must be greater than zero', 400);
  }

  if (!Number.isFinite(maxAttempts) || maxAttempts <= 0) {
    throw new ApiError('Max attempts must be greater than zero', 400);
  }

  return {
    program_id: programId,
    title,
    description: getOptionalString(source.description),
    pass_mark: Math.trunc(passMark),
    time_limit_minutes: Math.trunc(timeLimitMinutes),
    max_attempts: Math.trunc(maxAttempts),
    is_published: getBoolean(source.is_published, false),
  };
}

export function parseAcademyQuestionInput(body: unknown): AcademyExamQuestionInput {
  const source = getObject(body);
  const examId = getString(source.exam_id);
  const questionText = getString(source.question_text);
  const questionType = getString(source.question_type);
  const options = getStringArray(source.options).filter(Boolean);
  const correctAnswer = getStringArray(source.correct_answer).filter(Boolean);
  const points = getNumber(source.points);
  const orderIndex = getNumber(source.order_index);

  if (!examId) {
    throw new ApiError('Exam is required', 400);
  }

  if (!questionText) {
    throw new ApiError('Question text is required', 400);
  }

  if (!['single_choice', 'multiple_choice', 'true_false'].includes(questionType)) {
    throw new ApiError('Question type is invalid', 400);
  }

  if (questionType === 'true_false' && options.length === 0) {
    options.push('true', 'false');
  }

  if (options.length < 2) {
    throw new ApiError('At least two options are required', 400);
  }

  if (correctAnswer.length === 0) {
    throw new ApiError('At least one correct answer is required', 400);
  }

  if (questionType !== 'multiple_choice' && correctAnswer.length > 1) {
    throw new ApiError('Only one correct answer is allowed for this question type', 400);
  }

  if (!Number.isFinite(points) || points <= 0) {
    throw new ApiError('Points must be greater than zero', 400);
  }

  if (!Number.isFinite(orderIndex) || orderIndex < 0) {
    throw new ApiError('Question order must be zero or greater', 400);
  }

  return {
    exam_id: examId,
    question_text: questionText,
    question_type: questionType as AcademyExamQuestionInput['question_type'],
    options,
    correct_answer: correctAnswer,
    points: Math.trunc(points),
    order_index: Math.trunc(orderIndex),
    explanation: getOptionalString(source.explanation),
    is_active: getBoolean(source.is_active, true),
  };
}

export function parseAcademyEnrollmentInput(body: unknown): AcademyEnrollmentInput {
  const source = getObject(body);
  const applicationId = getString(source.application_id);
  const programId = getString(source.program_id);

  if (!applicationId || !programId) {
    throw new ApiError('Application and program are required', 400);
  }

  return { application_id: applicationId, program_id: programId };
}

export function parseAcademyStageOverrideInput(body: unknown): AcademyStageOverrideInput {
  const source = getObject(body);
  const stage = getString(source.stage);
  const reason = getOptionalString(source.reason);

  if (!ACADEMY_CANDIDATE_STAGES.includes(stage as AcademyCandidateStage)) {
    throw new ApiError('Candidate stage is invalid', 400);
  }

  return {
    stage: stage as AcademyCandidateStage,
    reason,
  };
}

export function parseAcademyExamSubmissionInput(body: unknown): AcademyExamSubmissionInput {
  const source = getObject(body);
  const answers = source.answers;

  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new ApiError('Exam answers are required', 400);
  }

  const normalizedAnswers = Object.fromEntries(
    Object.entries(answers as Record<string, unknown>).map(([key, value]) => [
      key,
      getStringArray(value),
    ])
  );

  return { answers: normalizedAnswers };
}

export function parseAcademyPracticalSessionInput(body: unknown): AcademyPracticalSessionInput {
  const source = getObject(body);
  const title = getString(source.title);
  const venue = getString(source.venue);
  const address = getString(source.address);
  const sessionDate = getString(source.session_date);
  const startTime = getString(source.start_time);
  const capacity = getNumber(source.capacity);

  if (!title || !venue || !address || !sessionDate || !startTime) {
    throw new ApiError('Title, venue, address, date, and start time are required', 400);
  }

  if (!Number.isFinite(capacity) || capacity < 0) {
    throw new ApiError('Capacity must be zero or greater', 400);
  }

  return {
    program_id: getOptionalString(source.program_id) || null,
    batch_id: getOptionalString(source.batch_id) || null,
    title,
    venue,
    address,
    session_date: sessionDate,
    start_time: startTime,
    instructions: getOptionalString(source.instructions),
    capacity: Math.trunc(capacity),
  };
}

export function parseAcademyPracticalInvitationInput(
  body: unknown
): AcademyPracticalInvitationInput {
  const source = getObject(body);
  const sessionId = getString(source.session_id);
  const enrollmentId = getString(source.enrollment_id);

  if (!sessionId || !enrollmentId) {
    throw new ApiError('Session and candidate are required', 400);
  }

  return {
    session_id: sessionId,
    enrollment_id: enrollmentId,
    notes: getOptionalString(source.notes),
  };
}
