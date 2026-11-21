// GET /api/registration/applications/:id/workflow
//
// The Open Mic progress for one application: which edition it belongs to, and
// the milestones the artist has actually reached — beat downloaded, song
// uploaded, song handed in, decision recorded.
//
// A NEW route, not extra fields on /applications/:id/status, which is a
// brownfield-protected file (see .claude/hooks/protect-legacy.sh); the hook's own
// guidance is to put new registration behaviour in registration-v2/. Same reason
// the sibling /voting route exists.
//
// Auth mirrors /voting exactly: a signed-in caller may only read their OWN
// application. A non-Open-Mic application is a 200 with `isOpenMic: false`, not a
// 404 — the client then simply renders nothing extra.
import { successResponse, handleApiError, errorResponse } from '@/src/lib/api/responses';
import { getRegistrationDraft } from '@/src/server/registration/supabase-store';
import { getApplicationWorkflow } from '@/src/server/registration-v2/workflow-steps';
import { requireUser } from '@/src/lib/auth/server';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    const { user } = await requireUser(request);

    const draft = await getRegistrationDraft(params.id);
    if (!draft) return errorResponse('Application not found', 404);
    if (draft.userId !== user.id) return errorResponse('Forbidden', 403);

    const workflow = await getApplicationWorkflow(params.id);
    if (!workflow) return errorResponse('Application not found', 404);

    return successResponse({ success: true, workflow });
  } catch (error) {
    return handleApiError(error, 'Failed to load application workflow');
  }
}
