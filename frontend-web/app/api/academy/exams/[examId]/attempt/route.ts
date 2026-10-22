// Learner: start (or resume, via the idempotency key) an authoritative attempt.
// The draw + shuffled presentation + server deadline happen entirely here; the
// client sends no ids it can be trusted for.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy';
import {
  ExamError,
  examEligibility,
  loadPublishedExam,
  startAttempt,
} from '@/src/server/services/academy/assessment';

function readKey(request: Request, body: { idempotencyKey?: unknown } | null): string {
  const fromBody = body && typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
  const fromHeader = request.headers.get('idempotency-key') ?? '';
  return (fromBody || fromHeader).trim() || crypto.randomUUID();
}

export async function POST(request: Request, ctx: { params: Promise<{ examId: string }> }) {
  try {
    if (!featureFlags.filmAcademyAssessment()) {
      return errorResponse('Assessments are not available yet', 503);
    }
    const user = await requireRequestUser(request);
    const { examId } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { idempotencyKey?: string } | null;

    const supabase = createAdminClient();
    const learner = await resolveLearner(supabase, user.id);
    if (!learner.ok) {
      return errorResponse('You are not enrolled in a programme with exams yet', 403);
    }

    const exam = await loadPublishedExam(supabase, examId);
    if (!exam) return errorResponse('Exam not found', 404);

    const learnerRef = { enrollmentId: learner.enrollmentId, programId: learner.programId, batchId: learner.batchId };
    const gate = await examEligibility(supabase, exam, learnerRef);
    if (!gate.ok) {
      return errorResponse(gate.message, gate.code === 'EXAM_UNPUBLISHED' ? 404 : 403);
    }

    const started = await startAttempt(supabase, exam, learnerRef, user.id, readKey(request, body));
    return successResponse({ success: true, attempt: started });
  } catch (error) {
    if (error instanceof ExamError) return errorResponse(error.message, error.status);
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to start the exam');
  }
}
