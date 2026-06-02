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

    return successResponse({ success: true, settings: data ?? [] });
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
