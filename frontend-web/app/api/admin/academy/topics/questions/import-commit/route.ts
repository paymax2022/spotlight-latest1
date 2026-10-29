// Admin: commit topic-targeted question rows as DRAFTS.
// The service re-validates the CSV rather than trusting the preview. Rows that
// already have a reviewed status, a module binding or another topic are locked.
// Import NEVER approves a question, so no row becomes drawable here.
// Permission: programs:manage.
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import {
  applyTopicQuestionImport,
  asActorId,
} from '@/src/server/services/academy/topics';
import { topicErrorResponse } from '@/src/server/services/academy/topics/http';

const PERMISSION = 'programs:manage';

export async function POST(request: Request) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    const identity = await assertAdminPermission(request, PERMISSION);
    const body = (await request.json().catch(() => null)) as
      | { filename?: string; csv?: string }
      | null;
    const csv = typeof body?.csv === 'string' ? body.csv : '';
    if (!csv.trim()) return errorResponse('Provide the CSV text in `csv`', 400);
    const filename = String(body?.filename ?? 'tmfa-topic-questions.csv');

    const supabase = createAdminClient();
    const result = await applyTopicQuestionImport(
      supabase,
      asActorId(identity.actorId),
      filename,
      csv,
    );
    return successResponse({ success: true, result });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to import the topic questions');
  }
}
