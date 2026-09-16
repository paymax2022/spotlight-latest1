import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { getOrCreateShareLink, buildShareMessages, recordShareEvent } from '@/src/server/voting/share.service';
import { createAdminClient } from '@/lib/supabase/server';

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

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.spotlightng.com';

    // Get contestant info for share message
    const supabase = createAdminClient();
    const { data: contestant } = await supabase
      .from('competition_enrollments')
      .select('stage_name, user_profiles(full_name), competitions(name, slug)')
      .eq('id', contestantId)
      .maybeSingle();

    const contestantName =
      (contestant as any)?.stage_name ||
      (contestant as any)?.user_profiles?.full_name ||
      'Contestant';
    const contestName = (contestant as any)?.competitions?.name ?? 'Spotlight Contest';

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
    const body = (await request.json()) as {
      shareLinkId: string;
      channel?: string;
      eventType?: 'click' | 'share';
    };

    if (!body.shareLinkId) {
      return Response.json({ success: false, error: 'shareLinkId is required' }, { status: 400 });
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
