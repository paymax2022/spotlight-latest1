import { notFound } from 'next/navigation';
import { getContestById, getLeaderboard } from '@/src/server/openmic/persistence';
import VoteRiskControls from '@/components/openmic/admin/VoteRiskControls';

export const dynamic = 'force-dynamic';

export default async function AdminOpenMicVotesPage({ params }: { params: { contestId: string } }) {
  const contest = await getContestById(params.contestId);
  if (!contest) notFound();
  const leaderboard = await getLeaderboard(contest.id);
  const totalVotes = leaderboard.reduce((sum, row) => sum + row.voteCount, 0);
  const votingRevenue = totalVotes * (contest.votingConfig.votePrice || 0);

  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <h1 className="font-display text-3xl text-foreground">Voting Management</h1>
      <p className="text-foreground-muted mt-1">{contest.title}</p>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
        <div className="glass-card rounded-md p-4"><p className="text-xs text-foreground/60">Total Votes</p><p className="text-2xl text-foreground font-semibold">{totalVotes}</p></div>
        <div className="glass-card rounded-md p-4"><p className="text-xs text-foreground/60">Vote Price</p><p className="text-2xl text-foreground font-semibold">₦{contest.votingConfig.votePrice}</p></div>
        <div className="glass-card rounded-md p-4"><p className="text-xs text-foreground/60">Voting Revenue</p><p className="text-2xl text-foreground font-semibold">₦{votingRevenue}</p></div>
        <div className="glass-card rounded-md p-4"><p className="text-xs text-foreground/60">Visibility</p><p className="text-sm text-foreground font-semibold">{contest.votingConfig.voteCountPublic ? 'Vote count visible' : 'Vote count hidden'}</p></div>
      </div>
      <VoteRiskControls
        contestId={contest.id}
        suspiciousVoteThreshold={contest.votingConfig.suspiciousVoteThreshold || 100}
        suspiciousVoteHighThreshold={contest.votingConfig.suspiciousVoteHighThreshold || 300}
      />

      <div className="glass-card rounded-md p-4 mt-4">
        <h3 className="text-foreground font-semibold mb-2">Top 10 Ranking</h3>
        <ol className="space-y-1 text-sm text-foreground/80">
          {leaderboard.slice(0, 10).map((entry, index) => (
            <li key={entry.id}>
              #{index + 1} {entry.stageName} — {entry.songTitle} ({entry.voteCount} votes)
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
