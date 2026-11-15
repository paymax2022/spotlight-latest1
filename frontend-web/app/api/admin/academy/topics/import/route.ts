// Admin: idempotent import of the bundled TMFA curriculum pack.
// GET previews the exact write plan (counts + rejected rows) without writing.
// POST commits it. The import NEVER approves a question or publishes a topic.
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import {
  asActorId,
  buildBundledImportPlan,
  importBundledCurriculumPack,
} from '@/src/server/services/academy/topics';
import { topicErrorResponse } from '@/src/server/services/academy/topics/http';

export async function GET(request: Request) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    await assertAdminPermission(request, 'programs:manage');
    const plan = buildBundledImportPlan();
    return successResponse({
      success: true,
      preview: {
        version: plan.version,
        sourceHash: plan.sourceHash,
        courseCount: plan.courses.length,
        topicCount: plan.topics.length,
        mediaCount: plan.media.length,
        questionCount: plan.questions.length,
        rejectedQuestionCount: plan.rejectedQuestions.length,
        rejectedQuestions: plan.rejectedQuestions.slice(0, 25),
        warnings: plan.warnings,
        // A preview must show the exact plan shape without dumping 300 KB.
        courses: plan.courses.map((c) => ({
          courseId: c.courseId,
          title: c.title,
          kind: c.kind,
          stageLabel: c.stageLabel,
          topicCount: c.topicCount,
        })),
      },
    });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to preview the curriculum import');
  }
}

export async function POST(request: Request) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    const admin = await assertAdminPermission(request, 'programs:manage');
    const supabase = createAdminClient();
    const result = await importBundledCurriculumPack(supabase, asActorId(admin.actorId));
    return successResponse({ success: true, result });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to import the curriculum');
  }
}
