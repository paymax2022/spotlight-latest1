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

    if (contestErr) {
      // A malformed slug surfaces as a PostgREST request error: PGRST1xx when
      // the `eq.` operand can't be parsed, and PGRST2xx / SQLSTATE 42601/42703
      // when a crafted `or`/`and` fragment is instead resolved as logic or an
      // identifier (e.g. `?contestSlug=' OR 1=1`). All are bad client input →
      // 400. Any other error is a real backend fault; collapsing it into
      // "Contest not found" 404 hides outages.
      const code = contestErr.code ?? '';
      if (/^PGRST[12]/.test(code) || /^(42601|42703)$/.test(code)) {
        return errorResponse('Invalid contestSlug', 400);
      }
      throw contestErr;
    }
    if (!contest) return errorResponse('Contest not found', 404);
    const contestId = (contest as any).id;

    // 2. Resolve contestant on the `contestants` roster — the table votes.contestant_id
    //    references (competition_enrollments is a separate, empty enrollment table).
    //    Two lookup strategies: (a) voting_link_slug column, (b) id for UUID links.
    const CONTESTANT_COLS =
      'id, name, stage_name, bio, photo_url, category, state, media_url, status, voting_link_slug';
    let enrollment: any = null;

    // Strategy (a): direct slug column match
    const { data: bySlug } = await supabase
      .from('contestants')
      .select(CONTESTANT_COLS)
      .eq('contest_id', contestId)
      .eq('voting_link_slug', contestantSlug)
      .maybeSingle();

    if (bySlug) {
      enrollment = bySlug;
    } else {
      // Strategy (b): UUID match. Canonical-UUID gate — the loose 36-char
      // shape it replaced let non-UUID strings reach `.eq('id', …)` on a uuid
      // column and bounce back as a swallowed Postgres 22P02 error.
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contestantSlug);
      if (isUuid) {
        const { data: byId } = await supabase
          .from('contestants')
          .select(CONTESTANT_COLS)
          .eq('id', contestantSlug)
          .eq('contest_id', contestId)
          .maybeSingle();
        enrollment = byId;
      }
    }

    if (!enrollment) return errorResponse('Contestant not found', 404);

    const contestantId = enrollment.id;

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
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.spotlightng.com';

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
        name: enrollment.name ?? enrollment.stage_name ?? 'Contestant',
        stageName: enrollment.stage_name ?? null,
        photoUrl: enrollment.photo_url ?? null,
        bio: enrollment.bio ?? null,
        category: enrollment.category ?? null,
        state: enrollment.state ?? null,
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
