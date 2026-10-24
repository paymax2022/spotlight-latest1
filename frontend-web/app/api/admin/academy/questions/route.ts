// Admin question bank list + in-place edit of a DRAFT/REVIEW item.
// GET filters the film-scoped bank (status/stage/module/search, paged). This is the
// review surface so rows carry options + answer key; it is gated by programs:manage
// and the table's is_admin() RLS, and is never reachable from a learner route.
// PATCH edits only a draft/review item (approved/retired are locked) and recomputes
// the source hash so a later reimport is recognised as changed.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { listQuestions, editQuestion, type QuestionEdit } from '@/src/server/services/academy/assessment';

const PERMISSION = 'programs:manage';

function paging(url: URL): { page: number; pageSize: number } {
  const rawPage = Number(url.searchParams.get('page') ?? '1');
  const rawSize = Number(url.searchParams.get('pageSize') ?? '25');
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize = Number.isFinite(rawSize) && rawSize >= 1 ? Math.min(Math.floor(rawSize), 100) : 25;
  return { page, pageSize };
}

export async function GET(request: Request) {
  try {
    if (!featureFlags.filmAcademyAssessment()) {
      return errorResponse('Assessments are not available yet', 503);
    }
    await assertAdminPermission(request, PERMISSION);
    const url = new URL(request.url);
    const { page, pageSize } = paging(url);
    const supabase = createAdminClient();
    const { rows, total } = await listQuestions(supabase, {
      status: url.searchParams.get('status') ?? undefined,
      stage: url.searchParams.get('stage') ?? undefined,
      moduleCode: url.searchParams.get('moduleCode') ?? undefined,
      q: url.searchParams.get('q') ?? undefined,
      page, pageSize,
    });
    return successResponse({ success: true, questions: rows, page, pageSize, total, hasMore: page * pageSize < total });
  } catch (error) {
    return handleApiError(error, 'Failed to load questions');
  }
}

export async function PATCH(request: Request) {
  try {
    if (!featureFlags.filmAcademyAssessment()) {
      return errorResponse('Assessments are not available yet', 503);
    }
    await assertAdminPermission(request, PERMISSION);
    const body = (await request.json().catch(() => null)) as { id?: string } & QuestionEdit | null;
    const id = String(body?.id ?? '').trim();
    if (!id) return errorResponse('id is required', 400);

    const supabase = createAdminClient();
    const result = await editQuestion(supabase, id, body ?? {});
    if (!result.ok) return errorResponse(result.error ?? 'Failed to save', 400);
    return successResponse({ success: true });
  } catch (error) {
    return handleApiError(error, 'Failed to save the question');
  }
}
