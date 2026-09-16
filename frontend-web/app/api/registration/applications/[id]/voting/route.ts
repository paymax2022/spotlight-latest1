// GET /api/registration/applications/:id/voting
//
// The voting context for one application: the contest it is running in, the
// roster entry it became, and whether people can vote for it right now.
//
// This is a NEW route rather than extra fields on
// /applications/:id/status, which is a brownfield-protected file (see
// .claude/hooks/protect-legacy.sh). Additive by design, per the hook's own
// guidance to put new registration behaviour in registration-v2/.
//
// Auth mirrors the status route exactly: a signed-in caller may only read their
// OWN application. The response is deliberately non-404 for an application that
// simply is not votable yet — it carries a `reason` so the client can explain
// itself instead of hiding the section.
import { successResponse, handleApiError, errorResponse } from '@/src/lib/api/responses';
import { getRegistrationDraft } from '@/src/server/registration/supabase-store';
import { getRegistrationVoting } from '@/src/server/registration-v2/registration-voting';
import { requireUser } from '@/src/lib/auth/server';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    const { user } = await requireUser(request);

    // Ownership is checked against the application itself, exactly as the
    // status route does — the voting payload exposes the applicant's roster
    // entry and must not be readable by another signed-in user.
    const draft = await getRegistrationDraft(params.id);
    if (!draft) return errorResponse('Application not found', 404);
    if (draft.userId !== user.id) return errorResponse('Forbidden', 403);

    const voting = await getRegistrationVoting(params.id);
    if (!voting) return errorResponse('Application not found', 404);

    return successResponse({ success: true, voting });
  } catch (error) {
    return handleApiError(error, 'Failed to load application voting details');
  }
}
