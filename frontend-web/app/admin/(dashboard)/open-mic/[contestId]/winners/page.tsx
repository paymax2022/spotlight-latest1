import { notFound } from 'next/navigation';
import { getContestById, listSubmissions } from '@/src/server/openmic/persistence';

export const dynamic = 'force-dynamic';

export default async function AdminOpenMicWinnersPage({ params }: { params: { contestId: string } }) {
  const contest = await getContestById(params.contestId);
  if (!contest) notFound();
  const submissions = await listSubmissions({ contestId: contest.id });
  const winners = submissions.filter((item) => item.status === 'winner' || item.isWinner);

  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <h1 className="font-display text-3xl text-foreground">Manage Winners</h1>
      <p className="text-foreground-muted mt-1">{contest.title}</p>
      <div className="glass-card rounded-md p-4 mt-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-foreground/70">
              <th className="py-2 pr-3">Winner</th>
              <th className="py-2 pr-3">Song</th>
              <th className="py-2 pr-3">Votes</th>
              <th className="py-2 pr-3">Prize Track</th>
            </tr>
          </thead>
          <tbody>
            {winners.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="py-2 pr-3">{row.stageName}</td>
                <td className="py-2 pr-3">{row.songTitle}</td>
                <td className="py-2 pr-3">{row.voteCount}</td>
                <td className="py-2 pr-3">{contest.prizes[0]?.title || 'Winner Perks'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {winners.length === 0 ? <p className="text-sm text-foreground/60 mt-2">No winner marked yet.</p> : null}
      </div>
    </section>
  );
}
