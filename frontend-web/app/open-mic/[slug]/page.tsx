import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContestBySlug, getLeaderboard } from '@/src/server/openmic/persistence';
import OpenMicProgressTracker from '@/components/openmic/OpenMicProgressTracker';

export const dynamic = 'force-dynamic';

export default async function OpenMicContestDetailsPage({ params }: { params: { slug: string } }) {
  const contest = await getContestBySlug(params.slug);
  if (!contest) notFound();
  const leaderboard = await getLeaderboard(contest.id);

  return (
    <main className="container py-5">
      <h1>{contest.title}</h1>
      <p>{contest.description}</p>

      <section className="my-4">
        <OpenMicProgressTracker currentStep={1} />
      </section>

      <section className="my-4 p-4 border rounded bg-white">
        <h3>Official Beat</h3>
        {contest.beat ? (
          <>
            <p>
              {contest.beat.beatTitle} by {contest.beat.producerCredit || contest.beat.producerName}
            </p>
            <p>{contest.beat.usageRules}</p>
            {contest.beat.previewUrl ? (
              <audio controls className="w-100">
                <source src={contest.beat.previewUrl} />
              </audio>
            ) : null}
          </>
        ) : (
          <p>Beat not uploaded yet for this edition.</p>
        )}
      </section>

      <section className="my-4 p-4 border rounded bg-white">
        <h3>Contest Rules Snapshot</h3>
        <p>Selection model: {contest.selectionModel.replace(/_/g, ' ')}</p>
        <p>Finalists target: Top {contest.finalistsTarget}</p>
        <p>Voting weight: {contest.publicVoteWeight}% public / {contest.judgeWeight}% judges</p>
        <p>
          Finale: {contest.finale.venueName}, {contest.finale.city}, {contest.finale.state}
        </p>
      </section>

      <section className="my-4 p-4 border rounded bg-white">
        <h3>Top Songs</h3>
        {leaderboard.length === 0 ? <p>No songs published for voting yet.</p> : null}
        <ol className="mb-0">
          {leaderboard.slice(0, 10).map((entry) => (
            <li key={entry.id} className="mb-2">
              <strong>{entry.songTitle}</strong> - {entry.stageName} ({entry.voteCount} votes)
            </li>
          ))}
        </ol>
      </section>

      <div className="d-flex gap-2 flex-wrap">
        <Link href={`/open-mic/${contest.slug}/apply`} className="btn btn-primary">
          Apply Now
        </Link>
        <Link href={`/open-mic/${contest.slug}/enter`} className="btn btn-primary">
          Submit Your Song
        </Link>
        <Link href={`/open-mic/${contest.slug}/entries`} className="btn btn-outline-secondary">
          Public Voting
        </Link>
        <Link href={`/dashboard/open-mic/${contest.slug}`} className="btn btn-outline-secondary">
          Artist Dashboard
        </Link>
        <Link href={`/open-mic/${contest.slug}/finale`} className="btn btn-outline-secondary">
          Finale Venue
        </Link>
        <Link href="/open-mic" className="btn btn-outline-secondary">
          Back to Open Mic
        </Link>
      </div>
    </main>
  );
}
