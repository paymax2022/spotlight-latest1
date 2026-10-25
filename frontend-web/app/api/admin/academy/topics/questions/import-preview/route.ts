// Admin: topic-targeted question authoring.
// GET reports the required CSV columns and the current per-topic pool gap.
// POST validates a CSV without writing anything. Commit is a separate route.
// Permission: programs:manage.
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import {
  loadTopicQuestionAuthoringContext,
  previewTopicQuestionImport,
} from '@/src/server/services/academy/topics';
import { topicErrorResponse } from '@/src/server/services/academy/topics/http';

const PERMISSION = 'programs:manage';

export async function GET(request: Request) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    await assertAdminPermission(request, PERMISSION);
    const supabase = createAdminClient();
    const context = await loadTopicQuestionAuthoringContext(supabase);
    return successResponse({ success: true, context });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to load the question authoring context');
  }
}

export async function POST(request: Request) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    await assertAdminPermission(request, PERMISSION);
    const body = (await request.json().catch(() => null)) as { csv?: string } | null;
    const csv = typeof body?.csv === 'string' ? body.csv : '';
    if (!csv.trim()) return errorResponse('Provide the CSV text in `csv`', 400);

    const supabase = createAdminClient();
    const preview = await previewTopicQuestionImport(supabase, csv);
    return successResponse({ success: true, preview });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to preview the question import');
  }
}
