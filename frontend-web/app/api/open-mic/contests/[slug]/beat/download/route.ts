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

    // Public-facing redirect — a relative configured downloadUrl must resolve
    // on the public site origin, not request.url (http://0.0.0.0:PORT on
    // Railway/cPanel). Absolute URLs ignore the base either way.
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.spotlightng.com';
    return NextResponse.redirect(new URL(contest.beat.downloadUrl, siteUrl), 302);
  } catch (error) {
    return handleApiError(error, 'Failed to download beat');
  }
}

export async function POST(request: Request, context: { params: { slug: string } }) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json().catch(() => null)) as {
      artistName?: string;
      artistEmail?: string;
      termsAccepted?: boolean;
      paidAccessConfirmed?: boolean;
    };
    if (!body) return errorResponse('Invalid JSON body', 400);
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
    return handleApiError(error, 'Failed to log beat download');
  }
}
