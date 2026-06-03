import { notFound } from 'next/navigation';
import OpenMicEntryForm from '@/components/openmic/OpenMicEntryForm';
import { getContestBySlug } from '@/src/server/openmic/persistence';
import OpenMicProgressTracker from '@/components/openmic/OpenMicProgressTracker';
import OpenMicAuthGate from '@/components/openmic/OpenMicAuthGate';

export const dynamic = 'force-dynamic';

export default async function OpenMicContestEntryPage({ params }: { params: { slug: string } }) {
  const contest = await getContestBySlug(params.slug);
  if (!contest) notFound();

  return (
    <section className="about-section section-padding fix bg-cover" style={{ backgroundImage: 'url("/assets/img/service/service-bg-2.jpg")' }}>
      <div className="container">
        <div className="mb-4">
          <h1>Enter {contest.title}</h1>
          <p>
            Download/access the official beat, record your finished song, and submit before the deadline.
          </p>
          <div className="mt-3">
            <OpenMicProgressTracker currentStep={4} />
          </div>
        </div>

        <section className="glass-card rounded-md p-4">
          <OpenMicAuthGate nextPath={`/open-mic/${contest.slug}/enter`}>
            <OpenMicEntryForm
              contestSlug={contest.slug}
              contestTitle={contest.title}
              beatAvailable={Boolean(contest.beat)}
              beatRequiresPaidEntry={contest.beat?.requiresPaidEntryForDownload === true}
            />
          </OpenMicAuthGate>
        </section>
      </div>
    </section>
  );
}
