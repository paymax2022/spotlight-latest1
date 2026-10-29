// Admin: open or close ONE course for pilot delivery.
//
// This is the only sanctioned way to teach the curriculum before faculty and SME
// review, and it is deliberately narrow: it substitutes for the published and
// reviewed-pool preconditions, nothing else. It requires scores:manage — the same
// permission that approves an article — so a content author cannot open their own
// unreviewed course. It is refused outright under NODE_ENV=production, it never
// writes film_topics.published, and it is recorded in film_academic_audit with the
// reason typed by the operator.
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import {
  PILOT_NOTE_MIN_LENGTH,
  revokeCoursePilotUnlock,
  setCoursePilotUnlock,
} from '@/src/server/services/academy/topics';
import { topicErrorResponse } from '@/src/server/services/academy/topics/http';

type PilotBody = { action?: unknown; note?: unknown };

export async function POST(request: Request, ctx: { params: Promise<{ courseId: string }> }) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    const admin = await assertAdminPermission(request, 'scores:manage');
    const body = (await request.json().catch(() => null)) as PilotBody | null;
    const action = String(body?.action ?? '');
    const note = String(body?.note ?? '');
    if (action !== 'enable' && action !== 'revoke') {
      return errorResponse('action must be "enable" or "revoke"', 400);
    }
    if (note.trim().length < PILOT_NOTE_MIN_LENGTH) {
      return errorResponse(
        `A written reason of at least ${PILOT_NOTE_MIN_LENGTH} characters is required and is recorded in the academic audit trail`,
        400,
      );
    }

    const { courseId } = await ctx.params;
    const supabase = createAdminClient();
    const input = { courseId, actorId: admin.actorId, note };
    const result =
      action === 'enable' ? await setCoursePilotUnlock(supabase, input) : await revokeCoursePilotUnlock(supabase, input);

    return successResponse({
      success: true,
      pilot: result,
      // Say what this did NOT do, so nobody reads the response as an approval.
      notice:
        result.active
          ? `Topics stay unpublished and unapproved. Learners see them labelled "Pilot delivery", and no certificate can be issued from them.`
          : `The course is back to its real publication state.`,
    });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to update pilot delivery');
  }
}
