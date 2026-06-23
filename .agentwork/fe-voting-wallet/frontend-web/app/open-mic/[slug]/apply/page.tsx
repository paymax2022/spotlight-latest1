import { notFound, redirect } from 'next/navigation';
import { getContestBySlug, listContests } from '@/src/server/openmic/persistence';
import OpenMicEntryForm from '@/components/openmic/OpenMicEntryForm';
import OpenMicProgressTracker from '@/components/openmic/OpenMicProgressTracker';
import OpenMicAuthGate from '@/components/openmic/OpenMicAuthGate';
import Link from 'next/link';

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
    <section
      className="about-section section-padding fix bg-cover"
      style={{ backgroundImage: 'url("/assets/img/service/service-bg-2.jpg")' }}
    >
      <div className="container">
        <div className="service-details-wrapper">
          <div className="row g-4">
            <div className="col-12 col-lg-4 order-2 order-md-1">
              <div className="single-sidebar-widget">
                <div className="wid-title">
                  <h3>Application Journey</h3>
                </div>
                <div className="opening-category">
                  <ul>
                    <li><i className="fa-regular fa-circle-check" />Authenticate through central Open Mic login.</li>
                    <li><i className="fa-regular fa-circle-check" />Access/download the official beat first.</li>
                    <li><i className="fa-regular fa-circle-check" />Record your final song with your own lyrics/vocals.</li>
                    <li><i className="fa-regular fa-circle-check" />Complete the wizard and submit song details.</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="col-12 col-lg-8 order-1 order-md-2">
              <div className="service-details-items">
                <div className="details-content">
                  <h3>Apply: {contest.title}</h3>
                  <p className="mt-3">
                    This page follows the official flow: auth first, beat download second, and final song submission last.
                  </p>
                  <div className="mt-4 d-flex flex-wrap gap-2">
                    <Link href={`/open-mic/${contest.slug}`} className="theme-btn style-2">
                      View Contest Details
                      <i className="fa-solid fa-arrow-right-long" />
                    </Link>
                  </div>
                  <div className="mt-4">
                    <OpenMicProgressTracker currentStep={2} />
                  </div>
                  <div className="glass-card rounded-md p-4 mt-4" id="beat-step">
                    <OpenMicAuthGate nextPath={`/open-mic/${contest.slug}/apply`}>
                      <OpenMicEntryForm
                        contestSlug={contest.slug}
                        contestTitle={contest.title}
                        beatAvailable={Boolean(contest.beat)}
                        beatRequiresPaidEntry={contest.beat?.requiresPaidEntryForDownload === true}
                      />
                    </OpenMicAuthGate>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
