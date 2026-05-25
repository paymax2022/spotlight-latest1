import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { getContestBySlug, logBeatDownload } from '@/src/server/openmic/persistence';

export async function POST(request: Request, context: { params: { slug: string } }) {
  try {
    const body = (await request.json()) as {
      userId?: string;
      artistName?: string;
      artistEmail?: string;
      termsAccepted?: boolean;
      paidAccessConfirmed?: boolean;
    };
    if (!body.artistName?.trim()) return errorResponse('artistName is required', 400);
    if (!body.termsAccepted) return errorResponse('Beat usage terms must be accepted', 400);

    const contest = await getContestBySlug(context.params.slug);
    if (!contest) return errorResponse('Contest not found', 404);
    if (!contest.beat) return errorResponse('Beat is not available for this contest', 400);

    const log = await logBeatDownload({
      contestSlug: context.params.slug,
      userId: body.userId,
      artistName: body.artistName,
      artistEmail: body.artistEmail,
      termsAccepted: body.termsAccepted,
      paidAccessConfirmed: body.paidAccessConfirmed,
    });

    return successResponse(
      {
        success: true,
        download: log,
        beat: {
          id: contest.beat.id,
          title: contest.beat.beatTitle,
          previewUrl: contest.beat.previewUrl,
          downloadUrl: contest.beat.downloadUrl,
          usageRules: contest.beat.usageRules,
        },
      },
      201
    );
  } catch (error) {
    return handleApiError(error, 'Failed to log beat download');
  }
}

