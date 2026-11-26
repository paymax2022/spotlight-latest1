import { publicBeatUrl } from '@/src/features/openmic/beat-storage';
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { SITE_URL } from '@/src/lib/site-url';
import { resolveOpenMicEdition } from '@/src/server/openmic/edition-resolution';
import { logBeatDownload } from '@/src/server/openmic/persistence';
import { requireRequestUser } from '@/src/lib/auth/request';
import { NextResponse } from 'next/server';

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    // A caller may pass the catalog slug (`open-mic-competition`) or the edition's
    // own; one rule maps either onto the live edition — see resolveOpenMicEdition.
    const contest = await resolveOpenMicEdition(slug);
    if (!contest) return errorResponse('Contest not found', 404);
    if (!contest.beat) return errorResponse('Beat is not available for this contest', 404);
    if (!contest.beat.downloadUrl) return errorResponse('Beat download URL is not configured', 404);
    if (contest.beat.allowDownload === false || contest.beat.previewOnly === true) {
      return errorResponse('Beat download is locked for this contest', 403);
    }

    // Public-facing redirect — a relative configured downloadUrl must resolve
    // on the site origin, not request.url (http://0.0.0.0:PORT on Railway/cPanel).
    // Absolute URLs ignore the base either way.
    //
    // SITE_URL rather than a literal domain, for the same reason the metadata
    // base uses it: an explicit NEXT_PUBLIC_SITE_URL still wins in production, but
    // with no variable set, assuming the public domain made a development or
    // preview applicant leave the site they were applying on, land on production,
    // and get a 404 for a beat whose row only exists here. The download breaking
    // is the loud half of that bug; the silent half is that the 404 says "not
    // found" about a file the admin just uploaded.
    return NextResponse.redirect(new URL(contest.beat.downloadUrl, SITE_URL), 302);
  } catch (error) {
    return handleApiError(error, 'Failed to download beat');
  }
}

/**
 * The consented hand-over of the official beat.
 *
 * Recording it is the reason this POST exists: it used to answer the beat's URLs
 * and log nothing, which left `beat_download_logs` — the table the admin's beat
 * analytics reads via `listBeatDownloads` — permanently empty. `logBeatDownload`
 * re-validates the terms, the download lock and the paid-entry rule, and its
 * refusal sentences map to the status an artist can act on.
 *
 * An unavailable analytics store must not strand an applicant, though: the same
 * posture `logBeatDownload` already keeps around its own insert extends here to a
 * deployment with no Open Mic database configured, where the download stays
 * allowed and only the record is lost.
 */
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { slug } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      artistName?: string;
      artistEmail?: string;
      termsAccepted?: boolean;
      paidAccessConfirmed?: boolean;
    };
    if (!body) return errorResponse('Invalid JSON body', 400);
    if (!body.artistName?.trim()) return errorResponse('artistName is required', 400);
    if (!body.termsAccepted) return errorResponse('Beat usage terms must be accepted', 400);

    // A caller may pass the catalog slug (`open-mic-competition`) or the edition's
    // own; one rule maps either onto the live edition — see resolveOpenMicEdition.
    const contest = await resolveOpenMicEdition(slug);
    if (!contest) return errorResponse('Contest not found', 404);
    if (!contest.beat) return errorResponse('Beat is not available for this contest', 400);

    try {
      await logBeatDownload({
        contestSlug: slug,
        userId: user.id,
        artistName: body.artistName.trim(),
        artistEmail: body.artistEmail?.trim() || undefined,
        termsAccepted: true,
        paidAccessConfirmed: body.paidAccessConfirmed === true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.trim() : '';
      if (/not configured/i.test(message)) {
        // Storage of the audit row is unavailable, not the beat: keep going.
      } else if (/locked|paid entry/i.test(message)) {
        return errorResponse(message, 403);
      } else if (/not found/i.test(message)) {
        return errorResponse('Contest not found', 404);
      } else if (message) {
        return errorResponse(message, 400);
      }
    }

    return successResponse(
      {
        success: true,
        beat: {
          id: contest.beat.id,
          title: contest.beat.beatTitle,
          // The same public-reader rule the eligibility endpoint uses: a stored
          // value that is an owner-only path or an off-origin string is not
          // something an applicant can fetch, so it must not be handed back as
          // if it were.
          previewUrl: publicBeatUrl(contest.beat.previewUrl) || publicBeatUrl(contest.beat.downloadUrl),
          downloadUrl: publicBeatUrl(contest.beat.downloadUrl) || publicBeatUrl(contest.beat.previewUrl),
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
