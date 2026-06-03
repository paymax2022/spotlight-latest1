import { notFound } from 'next/navigation';
import { getContestById, getLeaderboard } from '@/src/server/openmic/persistence';
import VoteRiskControls from '@/components/openmic/admin/VoteRiskControls';
import VotingSettingsForm from '@/components/openmic/admin/VotingSettingsForm';

export const dynamic = 'force-dynamic';

export default async function AdminOpenMicVotesPage({ params }: { params: { contestId: string } }) {
  const contest = await getContestById(params.contestId);
  if (!contest) notFound();
  const leaderboard = await getLeaderboard(contest.id);
  const totalVotes = leaderboard.reduce((sum, row) => sum + row.voteCount, 0);
  const paidVotes = leaderboard.reduce((sum, row) => sum + row.voteCount, 0); // approximation
  const votingRevenue = totalVotes * (contest.votingConfig.votePrice || 0);

  return (
    <section className="max-w-5xl mx-auto px-2 md:px-4 pb-10">
      <h1 className="font-display text-3xl text-foreground">Voting Management</h1>
      <p className="text-foreground/50 mt-1 mb-5">{contest.title}</p>

      {/* ── Stats ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Votes', value: totalVotes.toLocaleString() },
          { label: 'Vote Price', value: `₦${(contest.votingConfig.votePrice || 0).toLocaleString()}` },
          { label: 'Est. Revenue', value: `₦${votingRevenue.toLocaleString()}` },
          { label: 'Free Votes/Day', value: String(contest.votingConfig.freeVotesPerDay ?? 3) },
        ].map(({ label, value }) => (
          <div key={label} className="glass-card rounded-md p-4">
            <p className="text-xs text-foreground/50 mb-1">{label}</p>
            <p className="text-2xl font-semibold text-foreground">{value}</p>
          </div>
        ))}
      </div>

      {/* ── Voting settings form ────────────────────────────────────── */}
      <VotingSettingsForm
        contestId={contest.id}
        initial={{
          enabled:           contest.votingConfig.enabled,
          freeVoting:        contest.votingConfig.freeVoting,
          freeVotesPerDay:   contest.votingConfig.freeVotesPerDay ?? 3,
          paidVoting:        contest.votingConfig.paidVoting,
          votePrice:         contest.votingConfig.votePrice,
          leaderboardVisible: contest.votingConfig.leaderboardVisible,
          voteCountPublic:   contest.votingConfig.voteCountPublic,
          votingStartAt:     contest.votingConfig.votingStartAt,
          votingEndAt:       contest.votingConfig.votingEndAt,
        }}
      />

      {/* ── Risk controls ───────────────────────────────────────────── */}
      <VoteRiskControls
        contestId={contest.id}
        suspiciousVoteThreshold={contest.votingConfig.suspiciousVoteThreshold || 100}
        suspiciousVoteHighThreshold={contest.votingConfig.suspiciousVoteHighThreshold || 300}
      />

      {/* ── Top 10 leaderboard ──────────────────────────────────────── */}
      <div className="glass-card rounded-md p-4 mt-4">
        <h3 className="text-foreground font-semibold mb-3">Live Leaderboard</h3>
        {leaderboard.length === 0 ? (
          <p className="text-sm text-foreground/50">No entries published for voting yet.</p>
        ) : (
          <ol className="space-y-2">
            {leaderboard.slice(0, 10).map((entry, i) => (
              <li key={entry.id} className="flex items-center gap-3 text-sm">
                <span style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#cd7f32' : 'var(--bg)',
                  color: i < 3 ? (i === 0 ? '#000' : '#fff') : 'var(--foreground-muted)',
                  fontWeight: 800, fontSize: 11, border: '1px solid var(--border)',
                }}>
                  {i + 1}
                </span>
                <span className="flex-1 text-foreground font-medium">{entry.stageName}</span>
                <span className="text-foreground/50">{entry.songTitle}</span>
                <span className="text-amber-500 font-semibold ml-auto">{entry.voteCount.toLocaleString()} votes</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
