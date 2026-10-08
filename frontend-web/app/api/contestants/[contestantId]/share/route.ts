import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { getOrCreateShareLink, buildShareMessages, recordShareEvent } from '@/src/server/voting/share.service';
import { createAdminClient } from '@/lib/supabase/server';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ contestantId: string }> },
) {
  try {
    const { contestantId } = await context.params;
    const { searchParams } = new URL(request.url);
    const contestId = searchParams.get('contestId');
    if (!contestId) {
      return Response.json({ success: false, error: 'contestId is required' }, { status: 400 });
    }
    // Non-UUID ids can never match — reject before the query so a malformed id
    // doesn't surface as a Postgres 22P02 → 500.
    if (!UUID_RE.test(contestId) || !UUID_RE.test(contestantId)) {
      return Response.json({ success: false, error: 'Invalid contest or contestant ID' }, { status: 400 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.spotlightng.com';

    const supabase = createAdminClient();
    const { data: contestant } = await supabase
      .from('contestants')
      .select('id, contest_id, name, stage_name, photo_url, contests(name, slug)')
      .eq('id', contestantId)
      .maybeSingle();

    if (!contestant || (contestant as any).contest_id !== contestId) {
      return Response.json(
        { success: false, error: 'Contestant not found' },
        { status: 404 },
      );
    }

    const contestantName =
      (contestant as any)?.name ||
      (contestant as any)?.stage_name ||
      'Contestant';
    const contestName = (contestant as any)?.contests?.name ?? 'Spotlight Contest';

    const link = await getOrCreateShareLink(contestId, contestantId, baseUrl);
    const messages = buildShareMessages(contestantName, contestName, link.shareUrl);

    return successResponse({ success: true, shareLink: link, shareMessages: messages });
  } catch (error) {
    return handleApiError(error, 'Failed to get share link');
  }
}

// Record a share click event
export async function POST(
  request: Request,
  context: { params: Promise<{ contestantId: string }> },
) {
  try {
    const body = (await request.json().catch(() => null)) as {
      shareLinkId: string;
      channel?: string;
      eventType?: 'click' | 'share';
    };
    if (!body) return errorResponse('Invalid JSON body', 400);

    if (!body.shareLinkId) {
      return Response.json({ success: false, error: 'shareLinkId is required' }, { status: 400 });
    }
    // contestant_share_links.id is uuid — a malformed value makes the existence
    // check in recordShareEvent throw a Postgres 22P02 that lands as a 500.
    if (!UUID_RE.test(body.shareLinkId)) {
      return Response.json({ success: false, error: 'Invalid shareLinkId' }, { status: 400 });
    }

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '0.0.0.0';

    await recordShareEvent({
      shareLinkId: body.shareLinkId,
      eventType: body.eventType ?? 'click',
      channel: body.channel,
      ipAddress: ip,
      userAgent: request.headers.get('user-agent') || undefined,
      referrer: request.headers.get('referer') || undefined,
    });

    return successResponse({ success: true });
  } catch (error) {
    return handleApiError(error, 'Failed to record share event');
  }
}
