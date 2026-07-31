// Data-loader route for the public voting page.
// Resolves contestSlug + contestantSlug → all data the page needs in one call.
import { handleApiError, successResponse, errorResponse } from '@/src/lib/api/responses';
import { createAdminClient } from '@/lib/supabase/server';
import { getVotingSettings, getRemainingFreeVotes } from '@/src/server/voting/free-vote.service';
import { getActiveVotePackages } from '@/src/server/voting/paid-vote.service';
import { getVoteTotals } from '@/src/server/voting/totals.service';
import { getOrCreateShareLink } from '@/src/server/voting/share.service';
import { getEffectiveVisibility } from '@/src/server/voting/visibility.service';

function getIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '0.0.0.0'
  );
}

async function tryGetUserId(request: Request): Promise<string | undefined> {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return undefined;
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser(token);
    return data.user?.id;
  } catch {
    return undefined;
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const contestSlug = searchParams.get('contestSlug');
    const contestantSlug = searchParams.get('contestantSlug');
    const ref = searchParams.get('ref') ?? undefined;

    if (!contestSlug || !contestantSlug) {
      return errorResponse('contestSlug and contestantSlug are required', 400);
    }

    const supabase = createAdminClient();

    // 1. Resolve contest by slug
    const { data: contest, error: contestErr } = await supabase
      .from('contests')
      .select('id, name, slug, status')
      .eq('slug', contestSlug)
      .maybeSingle();

    if (contestErr || !contest) return errorResponse('Contest not found', 404);
    const contestId = (contest as any).id;

    // 2. Resolve contestant by slug on competition_enrollments
    //    The slug is stored in metadata->>'slug' or as a generated value from stage_name.
    //    We support three lookup strategies in order of preference:
    //    (a) enrollment.slug column (if it exists)
    //    (b) enrollment id exactly matches contestantSlug (UUID links)
    //    (c) generated slug from stage_name / full_name
    let enrollment: any = null;

    // Strategy (a): direct slug column match
    const { data: bySlug } = await supabase
      .from('competition_enrollments')
      .select(`
        id, stage_name, status,
        user_profiles ( id, full_name, avatar_url, bio, state )
      `)
      .eq('contest_id', contestId)
      .eq('slug', contestantSlug)
      .maybeSingle();

    if (bySlug) {
      enrollment = bySlug;
    } else {
      // Strategy (b): UUID match
      const isUuid = /^[0-9a-f-]{36}$/i.test(contestantSlug);
      if (isUuid) {
        const { data: byId } = await supabase
          .from('competition_enrollments')
          .select(`
            id, stage_name, status,
            user_profiles ( id, full_name, avatar_url, bio, state )
          `)
          .eq('id', contestantSlug)
          .eq('contest_id', contestId)
          .maybeSingle();
        enrollment = byId;
      }
    }

    if (!enrollment) return errorResponse('Contestant not found', 404);

    const contestantId = enrollment.id;
    const profile = (enrollment.user_profiles ?? {}) as any;

    // 3. Load voting settings (may throw if voting not enabled)
    let settings: any = null;
    try {
      settings = await getVotingSettings(contestId);
    } catch {
      return errorResponse('Voting is not enabled for this contest', 400);
    }

    // 4. Parallel: packages, totals, share link, remaining votes
    const ip = getIp(request);
    const userId = await tryGetUserId(request);
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://spotlightng.com';

    const [packages, totals, shareLink, remaining, visibility] = await Promise.all([
      getActiveVotePackages(contestId),
      getVoteTotals(contestId, contestantId),
      getOrCreateShareLink(contestId, contestantId, baseUrl),
      getRemainingFreeVotes(contestId, { userId, ipAddress: ip }),
      getEffectiveVisibility(contestId),
    ]);

    // D-004: never leak hidden vote counts / rank to the public vote page.
    // Gate the serialized totals by the phase-aware effective visibility.
    // Authorized-admin surfaces read totals through admin routes, not this one.
    const safeTotals = totals
      ? {
          ...(visibility.showRank ? { rank: totals.rank } : {}),
          ...(visibility.showVoteCount
            ? {
                totalConfirmedVotes: totals.totalConfirmedVotes,
                freeVotes: totals.freeVotes,
                paidVotes: totals.paidVotes,
              }
            : {}),
        }
      : null;
    const totalsOut = safeTotals && Object.keys(safeTotals).length > 0 ? safeTotals : null;

    // 5. Record share-link click if ref param present
    if (ref && shareLink && shareLink.shareCode === ref) {
      // Fire-and-forget — don't block page load
      supabase.from('contestant_share_events').insert({
        share_link_id: shareLink.id,
        event_type: 'click',
        channel: 'direct',
        ip_address: ip,
        user_agent: request.headers.get('user-agent') ?? null,
        referrer: null,
      }).then(() => {});
    }

    return successResponse({
      contestant: {
        id: contestantId,
        name: profile.full_name ?? enrollment.stage_name ?? 'Contestant',
        stageName: enrollment.stage_name ?? null,
        photoUrl: profile.avatar_url ?? null,
        bio: profile.bio ?? null,
        category: null,
        state: profile.state ?? null,
        videoUrl: null,
        audioUrl: null,
        contestName: (contest as any).name,
        contestSlug: (contest as any).slug,
      },
      settings,
      packages,
      totals: totalsOut,
      shareLink,
      freeVotesRemaining: remaining.freeVotesRemaining,
      freeVotesPerDay: remaining.freeVotesPerDay,
      resetAt: remaining.resetAt,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load voting page');
  }
}
