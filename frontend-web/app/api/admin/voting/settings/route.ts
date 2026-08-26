import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { appendAuditLog } from '@/src/server/voting/audit.service';

export async function GET(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const { searchParams } = new URL(request.url);
    const contestId = searchParams.get('contestId');

    const supabase = createAdminClient();
    let query = supabase.from('voting_settings').select('*').order('created_at', { ascending: false });
    if (contestId) query = query.eq('contest_id', contestId);

    const { data, error } = await query;
    if (error) return errorResponse('Failed to load settings', 500);

    // Every contest is listed, not only those that already have a settings row.
    //
    // Listing only configured contests was a chicken-and-egg: voting_settings is
    // written BY the settings page, which is reachable only from this list — so a
    // contest with no row could never be configured, and with the table empty the
    // dashboard showed "No voting settings configured yet" and no way forward.
    const { data: allContests, error: contestsErr } = await supabase
      .from('contests')
      .select('id, name, slug, status, voting_enabled, voting_type, vote_price_ngn')
      .order('created_at', { ascending: false });
    if (contestsErr) {
      console.error('[admin/voting/settings] contest list failed', contestsErr);
      return errorResponse('Failed to load contests', 500);
    }

    // voting_settings stores snake_case and carries no contest name. The admin
    // dashboard reads camelCase (contestId, contestName, …), so every field came
    // back undefined and its links rendered as /admin/voting/undefined/settings.
    // Map here, and join public.contests for the name/slug/status it needs.
    const rows = data ?? [];
    const contestIds = rows.map((r) => r.contest_id).filter(Boolean);
    const namesById = new Map<string, { name: string; slug: string | null; status: string }>();
    if (contestIds.length > 0) {
      const { data: contests } = await supabase
        .from('contests')
        .select('id, name, slug, status')
        .in('id', contestIds);
      for (const c of contests ?? []) {
        namesById.set(c.id as string, {
          name: (c.name as string) ?? '',
          slug: (c.slug as string) ?? null,
          status: (c.status as string) ?? 'draft',
        });
      }
    }

    const settingsByContest = new Map(rows.map((r) => [r.contest_id as string, r]));

    // A contest with no settings row is reported as unconfigured rather than
    // omitted, so it can be opened and configured. `configured` lets the
    // dashboard say which is which instead of implying every contest is set up.
    const source = contestId
      ? (allContests ?? []).filter((c) => c.id === contestId)
      : (allContests ?? []);

    const settings = source.map((c) => {
      const r = settingsByContest.get(c.id as string) ?? {};
      return {
        ...r,
        configured: settingsByContest.has(c.id as string),
        contestId: c.id,
        contestName: (c.name as string) ?? '',
        contestSlug: (c.slug as string) ?? '',
        status: (c.status as string) ?? 'draft',
        // The contest row is the authority for whether voting is on and what a
        // vote costs; voting_settings carries the rest of the configuration.
        votingEnabled: Boolean(c.voting_enabled),
        votingType: (c.voting_type as string) ?? 'free',
        votePriceNgn: Number(c.vote_price_ngn ?? 0),
        votingEndsAt: (r as Record<string, unknown>).voting_ends_at ?? null,
      };
    });

    return successResponse({ success: true, settings });
  } catch (error) {
    return handleApiError(error, 'Failed to load voting settings');
  }
}

export async function POST(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const body = await request.json();

    if (!body.contestId) return errorResponse('contestId is required', 400);

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('voting_settings')
      .upsert(
        {
          contest_id: body.contestId,
          voting_enabled: body.votingEnabled ?? false,
          voting_type: body.votingType ?? 'free',
          free_voting_enabled: body.freeVotingEnabled ?? true,
          free_votes_per_day: body.freeVotesPerDay ?? 3,
          daily_free_vote_cap_enabled: body.dailyFreeVoteCapEnabled ?? false,
          daily_free_vote_cap: body.dailyFreeVoteCap ?? null,
          free_vote_limit_scope: body.freeVoteLimitScope ?? 'user',
          require_login_for_free_vote: body.requireLoginForFreeVote ?? true,
          require_captcha: body.requireCaptcha ?? false,
          vote_cooldown_seconds: body.voteCooldownSeconds ?? 0,
          paid_voting_enabled: body.paidVotingEnabled ?? false,
          currency: body.currency ?? 'NGN',
          payment_provider: body.paymentProvider ?? 'paystack',
          payment_ref_prefix: body.paymentRefPrefix ?? 'SPT-VOTE',
          show_public_vote_count: body.showPublicVoteCount ?? true,
          show_public_leaderboard: body.showPublicLeaderboard ?? true,
          show_public_rank: body.showPublicRank ?? true,
          active_phase_key: body.activePhaseKey ?? null,
          allow_vote_sharing: body.allowVoteSharing ?? true,
          voting_starts_at: body.votingStartsAt ?? null,
          voting_ends_at: body.votingEndsAt ?? null,
          timezone: body.timezone ?? 'Africa/Lagos',
          leaderboard_freeze_enabled: body.leaderboardFreezeEnabled ?? false,
          leaderboard_freeze_at: body.leaderboardFreezeAt ?? null,
          fraud_detection_enabled: body.fraudDetectionEnabled ?? true,
          status: body.status ?? 'draft',
        },
        { onConflict: 'contest_id' },
      )
      .select('*')
      .single();

    if (error) return errorResponse(error.message, 500);

    await appendAuditLog({
      actorId: identity.actorId,
      actorRole: identity.role,
      action: 'voting_settings_updated',
      entityType: 'voting_settings',
      entityId: (data as any).id,
      contestId: body.contestId,
      newValue: body,
    });

    return successResponse({ success: true, settings: data });
  } catch (error) {
    return handleApiError(error, 'Failed to save voting settings');
  }
}
