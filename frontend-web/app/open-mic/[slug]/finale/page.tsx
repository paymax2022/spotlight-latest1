import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getContestBySlug, getFinalePlaylist } from '@/src/server/openmic/persistence';

export const dynamic = 'force-dynamic';

export default async function OpenMicFinalePage({ params }: { params: { slug: string } }) {
  const contest = await getContestBySlug(params.slug);
  if (!contest) notFound();
  const playlist = await getFinalePlaylist(contest.id);

  return (
    <main className="max-w-6xl mx-auto px-4 md:px-8 py-8">
      <h1 className="font-display text-3xl text-foreground">Monthly Finale</h1>
      <p className="text-foreground/70 mt-1">
        {contest.title} finale at {contest.finale.venueName} ({contest.finale.venueType.replace(/_/g, ' ')})
      </p>

      <section className="glass-card rounded-md p-4 mt-4">
        <h3 className="text-foreground font-semibold">Venue & Event Details</h3>
        <p className="text-sm text-foreground/70 mt-2">
          {contest.finale.address}, {contest.finale.city}, {contest.finale.state}
        </p>
        <p className="text-sm text-foreground/70">
          Date: {contest.finale.date || 'TBA'} • Show Time: {contest.finale.showStartTime || 'TBA'}
        </p>
      </section>

      <section className="glass-card rounded-md p-4 mt-4">
        <h3 className="text-foreground font-semibold mb-2">Finalist Running Order</h3>
        {playlist.length === 0 ? <p className="text-sm text-foreground/60">Finale lineup not published yet.</p> : null}
        <ol className="space-y-2">
          {playlist.map((item) => (
            <li key={`${item.order}-${item.submissionId}`} className="text-sm text-foreground/80">
              #{item.order} {item.stageName} — {item.songTitle}
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-4">
        <Link href={`/open-mic/${contest.slug}/entries`} className="btn-outline py-2 px-3 text-xs">View Voting Board</Link>
      </div>
    </main>
  );
}
