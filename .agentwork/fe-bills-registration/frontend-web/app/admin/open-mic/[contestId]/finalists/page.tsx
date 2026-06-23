import { notFound } from 'next/navigation';
import { generateFinalists, getContestById } from '@/src/server/openmic/persistence';

export const dynamic = 'force-dynamic';

export default async function AdminOpenMicFinalistsPage({ params }: { params: { contestId: string } }) {
  const contest = await getContestById(params.contestId);
  if (!contest) notFound();
  const finalists = await generateFinalists(contest.id);

  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <h1 className="font-display text-3xl text-foreground">Select Monthly Finalists</h1>
      <p className="text-foreground-muted mt-1">{contest.title}</p>
      <div className="glass-card rounded-md p-4 mt-4">
        <p className="text-sm text-foreground/70 mb-2">
          Finalist target: {contest.finalistsTarget} • Selection model: {contest.selectionModel.replace(/_/g, ' ')}
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-foreground/70">
              <th className="py-2 pr-3">Rank</th>
              <th className="py-2 pr-3">Artist</th>
              <th className="py-2 pr-3">Song Title</th>
              <th className="py-2 pr-3">Votes</th>
              <th className="py-2 pr-3">Finalist Status</th>
            </tr>
          </thead>
          <tbody>
            {finalists.map((row, index) => (
              <tr key={row.id} className="border-t border-border">
                <td className="py-2 pr-3">#{index + 1}</td>
                <td className="py-2 pr-3">{row.stageName}</td>
                <td className="py-2 pr-3">{row.songTitle}</td>
                <td className="py-2 pr-3">{row.voteCount}</td>
                <td className="py-2 pr-3">{row.isWinner ? 'Winner' : 'Selected'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
