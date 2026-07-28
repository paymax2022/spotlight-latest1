import { notFound } from 'next/navigation';
import { getContestById, getFinalePlaylist } from '@/src/server/openmic/persistence';

export const dynamic = 'force-dynamic';

export default async function AdminOpenMicFinalePage({ params }: { params: { contestId: string } }) {
  const contest = await getContestById(params.contestId);
  if (!contest) notFound();
  const playlist = await getFinalePlaylist(contest.id);

  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <h1 className="font-display text-3xl text-foreground">Manage Live Finale</h1>
      <p className="text-foreground-muted mt-1">{contest.title}</p>

      <div className="glass-card rounded-md p-4 mt-4">
        <h3 className="text-foreground font-semibold">Finale Venue</h3>
        <p className="text-sm text-foreground/70 mt-2">
          {contest.finale.venueName} • {contest.finale.venueType} • {contest.finale.address}, {contest.finale.city}, {contest.finale.state}
        </p>
        <p className="text-sm text-foreground/70">
          Event Date: {contest.finale.date || 'TBA'} • Show Time: {contest.finale.showStartTime || 'TBA'}
        </p>
      </div>

      <div className="glass-card rounded-md p-4 mt-4">
        <h3 className="text-foreground font-semibold mb-2">Performance Order</h3>
        {playlist.length === 0 ? <p className="text-sm text-foreground/60">No finale playlist yet.</p> : null}
        <ol className="space-y-1 text-sm text-foreground/80">
          {playlist.map((item) => (
            <li key={`${item.order}-${item.submissionId}`}>
              #{item.order} {item.stageName} — {item.songTitle} ({item.played ? 'Played' : 'Pending'})
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
