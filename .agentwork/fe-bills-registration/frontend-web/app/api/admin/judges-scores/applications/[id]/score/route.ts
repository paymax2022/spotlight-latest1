import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { getRegistrationDraft } from '@/src/server/registration/store';
import {
  upsertScorecard, listScorecardsForApplication,
  getScoreSummary, getRubricForContest,
  type Recommendation,
} from '@/src/server/services/scoring/store';
import { createClient } from '@/lib/supabase/server';

async function getJudgeName(userId: string): Promise<string> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from('user_profiles').select('full_name').eq('id', userId).maybeSingle();
    return (data as { full_name?: string } | null)?.full_name?.trim() || 'Judge';
  } catch {
    return 'Judge';
  }
}

// GET — fetch all scorecards for an application
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    await assertAdminPermission(request, 'scores:manage');

    const draft = getRegistrationDraft(params.id);
    if (!draft) return errorResponse('Application not found', 404);

    const scorecards = listScorecardsForApplication(params.id);
    const summary    = getScoreSummary(params.id);
    const rubric     = getRubricForContest(draft.contestSlug);

    return successResponse({ scorecards, summary, rubric });
  } catch (error) {
    return handleApiError(error, 'Failed to fetch scorecards');
  }
}

// POST — create or update this judge's scorecard
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const identity = await assertAdminPermission(request, 'scores:manage');

    const draft = getRegistrationDraft(params.id);
    if (!draft) return errorResponse('Application not found', 404);

    const body = await request.json() as {
      scores?: Record<string, number>;
      recommendation?: Recommendation;
      notes?: string;
    };

    if (!body.scores || typeof body.scores !== 'object') {
      return errorResponse('scores object is required', 400);
    }

    const judgeName = await getJudgeName(identity.actorId);

    const card = upsertScorecard({
      applicationId: params.id,
      judgeId:       identity.actorId,
      judgeName,
      contestSlug:   draft.contestSlug,
      scores:        body.scores,
      recommendation: (body.recommendation ?? 'pending') as Recommendation,
      notes:         body.notes ?? '',
    });

    const summary = getScoreSummary(params.id);
    return successResponse({ scorecard: card, summary });
  } catch (error) {
    return handleApiError(error, 'Failed to save scorecard');
  }
}
