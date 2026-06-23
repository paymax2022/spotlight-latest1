import Link from 'next/link';
import { notFound } from 'next/navigation';
import OpenMicProgressTracker from '@/components/openmic/OpenMicProgressTracker';
import { getContestBySlug, listSubmissions } from '@/src/server/openmic/persistence';

export const dynamic = 'force-dynamic';

export default async function ArtistOpenMicDashboardPage({ params }: { params: { slug: string } }) {
  const contest = await getContestBySlug(params.slug);
  if (!contest) notFound();
  const submissions = await listSubmissions({ contestId: contest.id });
  const latest = submissions[0];

  const currentStep = latest?.status === 'winner'
    ? 8
    : latest?.status === 'finalist'
      ? 7
      : latest?.status === 'published_for_voting'
        ? 5
        : latest?.status === 'approved'
          ? 4
          : latest?.status === 'submitted'
            ? 4
            : 2;

  return (
    <main className="max-w-6xl mx-auto px-4 md:px-8 py-8">
      <h1 className="font-display text-3xl text-foreground">Artist Dashboard: {contest.title}</h1>
      <p className="text-foreground/70 mt-1">Apply, download beat, submit your song, track votes, and qualify for the finale.</p>

      <div className="mt-4">
        <OpenMicProgressTracker currentStep={currentStep} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <section className="glass-card rounded-md p-4">
          <h3 className="text-foreground font-semibold">Contest Status</h3>
          <p className="text-sm text-foreground/70 mt-2">Lifecycle: {contest.status.replace(/_/g, ' ')}</p>
          <p className="text-sm text-foreground/70">Submission Window: {contest.submissionStartAt || 'TBA'} → {contest.submissionEndAt || 'TBA'}</p>
          <p className="text-sm text-foreground/70">Voting Window: {contest.votingConfig.votingStartAt || 'TBA'} → {contest.votingConfig.votingEndAt || 'TBA'}</p>
        </section>
        <section className="glass-card rounded-md p-4">
          <h3 className="text-foreground font-semibold">Beat Access</h3>
          <p className="text-sm text-foreground/70 mt-2">{contest.beat?.beatTitle || 'Official beat pending upload'}</p>
          <p className="text-sm text-foreground/70">Producer: {contest.beat?.producerCredit || contest.beat?.producerName || 'TBA'}</p>
          <p className="text-sm text-foreground/70">Access rule: {contest.beat?.requiresPaidEntryForDownload ? 'Paid application required' : 'Available after application'}</p>
        </section>
        <section className="glass-card rounded-md p-4">
          <h3 className="text-foreground font-semibold">Submission</h3>
          <p className="text-sm text-foreground/70 mt-2">Latest status: {latest?.status?.replace(/_/g, ' ') || 'Not submitted'}</p>
          <div className="mt-3 flex gap-2 flex-wrap">
            <Link href={`/open-mic/${contest.slug}/enter`} className="btn-primary py-2 px-3 text-xs">Upload Song</Link>
            <Link href={`/open-mic/${contest.slug}`} className="btn-outline py-2 px-3 text-xs">Contest Rules</Link>
          </div>
        </section>
        <section className="glass-card rounded-md p-4">
          <h3 className="text-foreground font-semibold">Voting & Finale</h3>
          <p className="text-sm text-foreground/70 mt-2">Votes: {latest?.voteCount || 0}</p>
          <p className="text-sm text-foreground/70">Finale Venue: {contest.finale.venueName}</p>
          <div className="mt-3 flex gap-2 flex-wrap">
            <Link href={`/open-mic/${contest.slug}/entries`} className="btn-outline py-2 px-3 text-xs">Public Voting Link</Link>
            <Link href={`/open-mic/${contest.slug}/finale`} className="btn-outline py-2 px-3 text-xs">Finale Details</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
