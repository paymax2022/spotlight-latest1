import { notFound } from 'next/navigation';
import OpenMicEntriesBoard from '@/components/openmic/OpenMicEntriesBoard';
import { getContestBySlug, getLeaderboard } from '@/src/server/openmic/persistence';
import Link from 'next/link';
import OpenMicProgressTracker from '@/components/openmic/OpenMicProgressTracker';

export const dynamic = 'force-dynamic';

export default async function OpenMicEntriesPage({ params }: { params: { slug: string } }) {
  const contest = await getContestBySlug(params.slug);
  if (!contest) notFound();
  const leaderboard = await getLeaderboard(contest.id);

  return (
    <main className="max-w-7xl mx-auto px-4 md:px-8 py-8">
      <div className="mb-4">
        <h1 className="font-display text-3xl text-foreground">Vote: {contest.title}</h1>
        <p className="text-foreground/70 mt-1">
          Listen to approved entries, support artists, and help select this month&apos;s finalists.
        </p>
        <div className="mt-3">
          <OpenMicProgressTracker currentStep={5} />
        </div>
        <div className="mt-3 flex gap-2 flex-wrap">
          <Link href={`/open-mic/${contest.slug}`} className="btn-outline py-2 px-3 text-xs">Contest Details</Link>
          <Link href={`/open-mic/${contest.slug}/enter`} className="btn-primary py-2 px-3 text-xs">Submit Your Song</Link>
        </div>
      </div>

      <OpenMicEntriesBoard
        contestId={contest.id}
        contestSlug={contest.slug}
        entries={leaderboard.map((entry) => ({
          id: entry.id,
          stageName: entry.stageName,
          songTitle: entry.songTitle,
          songUrl: entry.songUrl,
          voteCount: entry.voteCount,
          status: entry.status,
        }))}
        votePriceNgn={contest.votingConfig.votePrice}
        paidVoting={contest.votingConfig.paidVoting}
        freeVoting={contest.votingConfig.freeVoting}
      />
    </main>
  );
}
