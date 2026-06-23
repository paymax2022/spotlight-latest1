import Link from 'next/link';
import { listContests, listSubmissions } from '@/src/server/openmic/persistence';

export const dynamic = 'force-dynamic';

export default async function OpenMicWinnersPage() {
  const contests = await listContests({ includeNonPublic: true });
  const submissions = await listSubmissions();
  const winners = submissions.filter((item) => item.status === 'winner' || item.isWinner);

  return (
    <main className="max-w-7xl mx-auto px-4 md:px-8 py-8">
      <h1 className="font-display text-3xl text-foreground">Open Mic Winners</h1>
      <p className="text-foreground/70 mt-1">
        Monthly winners, prize tracks, and progression into Spotlight opportunities.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        {winners.map((winner) => {
          const contest = contests.find((c) => c.id === winner.contestId);
          return (
            <article key={winner.id} className="glass-card rounded-md p-4">
              <p className="text-xs text-foreground/60">{contest?.title || 'Open Mic Contest'}</p>
              <h3 className="text-foreground font-semibold mt-1">{winner.stageName}</h3>
              <p className="text-sm text-foreground/70">{winner.songTitle}</p>
              <p className="text-xs text-foreground/60 mt-2">Status: Winner</p>
              {contest ? (
                <Link href={`/open-mic/${contest.slug}/finale`} className="btn-outline py-2 px-3 text-xs mt-3 inline-block">
                  View Finale
                </Link>
              ) : null}
            </article>
          );
        })}
      </div>
      {winners.length === 0 ? <p className="text-sm text-foreground/60 mt-4">No winners announced yet.</p> : null}
    </main>
  );
}
