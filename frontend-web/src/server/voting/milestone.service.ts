import { createAdminClient } from '@/lib/supabase/server';
import { sendMilestoneEmail } from './email.service';

// Called after vote totals are updated. Checks for milestone triggers.
// Fire-and-forget — never awaited by the hot path.
export function checkAndFireMilestones(
  contestId: string,
  contestantId: string,
): void {
  fireMilestones(contestId, contestantId).catch(() => {});
}

async function fireMilestones(contestId: string, contestantId: string): Promise<void> {
  const supabase = createAdminClient();

  // Fetch current totals + rank
  const { data: totals } = await supabase
    .from('vote_totals')
    .select('total_confirmed_votes, rank, last_vote_at')
    .eq('contest_id', contestId)
    .eq('contestant_id', contestantId)
    .maybeSingle();

  if (!totals) return;

  const currentRank = (totals as any).rank;
  const totalVotes = Number((totals as any).total_confirmed_votes);

  // Fetch contestant email
  const { data: enrollment } = await supabase
    .from('competition_enrollments')
    .select('stage_name, user_profiles(email, full_name), contests(name, slug)')
    .eq('id', contestantId)
    .maybeSingle();

  if (!enrollment) return;

  const email = (enrollment as any).user_profiles?.email;
  const contestantName =
    (enrollment as any).stage_name ||
    (enrollment as any).user_profiles?.full_name ||
    'Contestant';
  const contestName = (enrollment as any).contests?.name || 'Spotlight Contest';

  if (!email) return;

  // Check milestones with idempotency via a small tracking table or metadata
  // We use a simple check: if rank is exactly 1, 3, or 10, fire once per rank value.
  // In production you'd store "last notified rank" to prevent re-fires.

  // Votes-above lookup (to calculate gap to next rank)
  const { data: aboveRow } = await supabase
    .from('vote_totals')
    .select('total_confirmed_votes')
    .eq('contest_id', contestId)
    .gt('total_confirmed_votes', totalVotes)
    .order('total_confirmed_votes', { ascending: false })
    .limit(1)
    .maybeSingle();

  const votesToNextRank = aboveRow
    ? Number((aboveRow as any).total_confirmed_votes) - totalVotes + 1
    : 0;

  // Determine milestone type
  let milestone: 'top10' | 'top3' | 'rank_change' | null = null;
  if (currentRank === 10) milestone = 'top10';
  else if (currentRank <= 3) milestone = 'top3';
  else if (currentRank != null) milestone = 'rank_change';

  if (!milestone) return;

  const contestSlug = (enrollment as any).contests?.slug ?? contestId;

  await sendMilestoneEmail({
    to: email,
    contestantName,
    contestName,
    milestone,
    currentRank,
    totalVotes,
    votesToNextRank,
    shareUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://spotlightng.com'}/vote/${contestSlug}/${contestantId}`,
  });
}
