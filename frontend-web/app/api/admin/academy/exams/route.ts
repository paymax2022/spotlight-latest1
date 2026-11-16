// Admin: list every exam (published or not) and create one. An exam is created
// UNPUBLISHED — publishExam is a separate, pool-preflighted action, so authoring
// can never expose an exam whose approved pool is short.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { listAllExams, createExam, type ExamInput } from '@/src/server/services/academy/assessment';

const PERMISSION = 'programs:manage';

export async function GET(request: Request) {
  try {
    if (!featureFlags.filmAcademyAssessment()) {
      return errorResponse('Assessments are not available yet', 503);
    }
    await assertAdminPermission(request, PERMISSION);
    const programId = new URL(request.url).searchParams.get('programId');
    const supabase = createAdminClient();
    const exams = await listAllExams(supabase, programId);
    return successResponse({ success: true, exams });
  } catch (error) {
    return handleApiError(error, 'Failed to load exams');
  }
}

export async function POST(request: Request) {
  try {
    if (!featureFlags.filmAcademyAssessment()) {
      return errorResponse('Assessments are not available yet', 503);
    }
    const identity = await assertAdminPermission(request, PERMISSION);
    const body = (await request.json().catch(() => null)) as ExamInput | null;
    if (!body || !body.program_id || !String(body.title ?? '').trim()) {
      return errorResponse('program_id and title are required', 400);
    }
    const supabase = createAdminClient();
    const exam = await createExam(supabase, body, uuidOrNull(identity.actorId));
    return successResponse({ success: true, exam });
  } catch (error) {
    return handleApiError(error, 'Failed to create the exam');
  }
}

function uuidOrNull(v: string | null | undefined): string | null {
  return v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
}
