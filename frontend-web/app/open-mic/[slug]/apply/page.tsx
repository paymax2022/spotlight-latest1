import { notFound, redirect } from 'next/navigation';
import { getContestBySlug, listContests } from '@/src/server/openmic/persistence';
import OpenMicApplicationForm from '@/components/openmic/OpenMicApplicationForm';
import OpenMicProgressTracker from '@/components/openmic/OpenMicProgressTracker';

export const dynamic = 'force-dynamic';

export default async function OpenMicApplyPage({ params }: { params: { slug: string } }) {
  let contest = await getContestBySlug(params.slug);
  if (!contest) {
    const contests = await listContests();
    const fallback =
      contests.find((row) =>
        ['registration_open', 'published', 'submission_open', 'voting_live'].includes(row.status)
      ) || contests[0];
    if (fallback) {
      redirect(`/open-mic/${fallback.slug}/apply`);
    }
    notFound();
  }

  return (
    <main className="max-w-5xl mx-auto px-4 md:px-8 py-8">
      <h1 className="font-display text-3xl text-foreground">Apply: {contest.title}</h1>
      <p className="text-foreground/70 mt-1">
        Complete this short application to unlock beat access and song submission.
      </p>
      <div className="mt-4">
        <OpenMicProgressTracker currentStep={1} />
      </div>
      <section className="glass-card rounded-md p-4 mt-4">
        <OpenMicApplicationForm contestSlug={contest.slug} requiresPayment={contest.entryFeeRequired} />
      </section>
    </main>
  );
}
