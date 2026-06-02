import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { getContestBySlug } from '@/src/server/openmic/persistence';
import { requireRequestUser } from '@/src/lib/auth/request';
import { NextResponse } from 'next/server';

export async function GET(request: Request, context: { params: { slug: string } }) {
  try {
    const contest = await getContestBySlug(context.params.slug);
    if (!contest) return errorResponse('Contest not found', 404);
    if (!contest.beat) return errorResponse('Beat is not available for this contest', 404);
    if (!contest.beat.downloadUrl) return errorResponse('Beat download URL is not configured', 404);
    if (contest.beat.allowDownload === false || contest.beat.previewOnly === true) {
      return errorResponse('Beat download is locked for this contest', 403);
    }

    return NextResponse.redirect(new URL(contest.beat.downloadUrl, request.url), 302);
  } catch (error) {
    return handleApiError(error, 'Failed to download beat');
  }
}

export async function POST(request: Request, context: { params: { slug: string } }) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json()) as {
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

    return successResponse(
      {
        success: true,
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
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    const message = error instanceof Error ? error.message : 'Failed to log beat download';
    if (/paid entry|payment/i.test(message)) return errorResponse(message, 400);
    if (/locked|not yet approved|window/i.test(message)) return errorResponse(message, 403);
    return handleApiError(new Error(message), message);
  }
}
