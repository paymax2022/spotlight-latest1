import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getContestBySlug, getLeaderboard } from '@/src/server/openmic/persistence';
import { slugifyArtist } from '@/src/features/openmic/workflow';

export const dynamic = 'force-dynamic';

export default async function OpenMicArtistEntryPage({
  params,
}: {
  params: { slug: string; artistSlug: string };
}) {
  const contest = await getContestBySlug(params.slug);
  if (!contest) notFound();
  const entries = await getLeaderboard(contest.id);
  const entry = entries.find((item) => slugifyArtist(item.stageName) === params.artistSlug);
  if (!entry) notFound();

  return (
    <main className="max-w-4xl mx-auto px-4 md:px-8 py-8">
      <p className="text-xs text-foreground/60">{contest.title}</p>
      <h1 className="font-display text-3xl text-foreground mt-1">{entry.songTitle}</h1>
      <p className="text-foreground/70 mb-3">Artist: {entry.stageName}</p>
      <div className="glass-card rounded-md p-4">
        <audio controls className="w-100">
          <source src={entry.songUrl} />
        </audio>
        <p className="text-sm text-foreground/70 mt-3">Current Votes: {entry.voteCount}</p>
        <div className="mt-3 flex gap-2">
          <Link href={`/open-mic/${contest.slug}/entries`} className="btn-primary py-2 px-3 text-xs">Vote Now</Link>
          <Link href={`/open-mic/${contest.slug}`} className="btn-outline py-2 px-3 text-xs">Back to Contest</Link>
        </div>
      </div>
    </main>
  );
}
