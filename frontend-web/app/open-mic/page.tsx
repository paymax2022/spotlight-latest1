import Link from 'next/link';
import Layout from '@/components/layout/Layout';
import { listContests } from '@/src/server/openmic/persistence';
import { hasUsableSupabaseConfig } from '@/src/lib/supabase/runtime';

export const dynamic = 'force-dynamic';

export default async function OpenMicLandingPage() {
  const dbConfigured = hasUsableSupabaseConfig();
  const contests = await listContests({ includeNonPublic: true });

  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle="Open Mic Competition"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section
        className="about-section section-padding fix bg-cover"
        style={{ backgroundImage: 'url("/assets/img/service/service-bg-2.jpg")' }}
      >
        <div className="container">
          <div className="service-details-wrapper">
            <div className="row g-4">
              <div className="col-12 col-lg-4 order-2 order-md-1">
                <div className="main-sidebar">
                  <div className="single-sidebar-widget">
                    <div className="wid-title">
                      <h3>How It Works</h3>
                    </div>
                    <div className="opening-category">
                      <ul>
                        <li><i className="fa-regular fa-circle-check" />Apply for the current monthly contest.</li>
                        <li><i className="fa-regular fa-circle-check" />Download the official beat after approval.</li>
                        <li><i className="fa-regular fa-circle-check" />Record and submit your finished song.</li>
                        <li><i className="fa-regular fa-circle-check" />Promote your entry and gather votes.</li>
                        <li><i className="fa-regular fa-circle-check" />Top artists perform at the live finale.</li>
                      </ul>
                    </div>
                  </div>

                  <div className="single-sidebar-widget">
                    <div className="wid-title">
                      <h3>Winner Perks</h3>
                    </div>
                    <div className="opening-category">
                      <ul>
                        <li><i className="fa-regular fa-circle-check" />Cash Prize</li>
                        <li><i className="fa-regular fa-circle-check" />Studio Session</li>
                        <li><i className="fa-regular fa-circle-check" />Music Video Support</li>
                        <li><i className="fa-regular fa-circle-check" />Media Promotion</li>
                        <li><i className="fa-regular fa-circle-check" />Label Consideration</li>
                      </ul>
                    </div>
                  </div>

                  <div
                    className="single-sidebar-image bg-cover"
                    style={{ backgroundImage: 'url("/assets/img/service/post.jpg")' }}
                  >
                    <div className="contact-text">
                      <div className="icon">
                        <i className="fa-solid fa-microphone-lines" />
                      </div>
                      <h4>Ready To Join?</h4>
                      <h5>
                        <Link href="/open-mic/winners">See Past Winners</Link>
                      </h5>
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-12 col-lg-8 order-1 order-md-2">
                <div className="service-details-items">
                  <div className="details-image">
                    <img src="/assets/img/shape/banner1.png" alt="Spotlight Open Mic Contest Banner" />
                  </div>

                  <div className="details-content">
                    <h3>Spotlight Open Mic: One Beat. One Song. One Shot.</h3>
                    <p className="mt-3">
                      Every month, Spotlight drops an official beat and emerging artists compete with original
                      songs built on that beat. Apply, submit, gather votes, and qualify for the live monthly finale.
                    </p>

                    <div className="details-video-items">
                      <div className="content">
                        <h4>Contest Journey</h4>
                        <ul className="list">
                          <li><i className="fa-regular fa-circle-check" />Apply</li>
                          <li><i className="fa-regular fa-circle-check" />Download Beat</li>
                          <li><i className="fa-regular fa-circle-check" />Record Song</li>
                          <li><i className="fa-regular fa-circle-check" />Submit Entry</li>
                          <li><i className="fa-regular fa-circle-check" />Get Votes</li>
                          <li><i className="fa-regular fa-circle-check" />Perform Live Finale</li>
                        </ul>
                      </div>
                    </div>

                    <h3 className="mt-4">Current and Upcoming Editions</h3>
                    {!dbConfigured ? (
                      <p className="mt-2 text-amber-300">
                        Open Mic is DB-driven. Supabase config is not active on this server instance.
                      </p>
                    ) : null}
                    {contests.length === 0 ? (
                      <p className="mt-2">
                        No open mic editions are currently available.
                        <Link href="/admin/open-mic/contests/new" className="ms-2">
                          Create one now
                        </Link>
                        .
                      </p>
                    ) : (
                      <div className="row g-4 mt-1">
                        {contests.map((contest) => (
                          <div className="col-12" key={contest.id}>
                            <div className="single-sidebar-widget mb-0">
                              <div className="wid-title d-flex flex-wrap justify-content-between align-items-center gap-2">
                                <h3 className="mb-0">
                                  <Link href={`/open-mic/${contest.slug}/apply`} className="text-decoration-none">
                                    {contest.title}
                                  </Link>
                                </h3>
                                <span className="badge-approved px-2 py-1 rounded-sm text-[11px]">
                                  {contest.status.replace(/_/g, ' ')}
                                </span>
                              </div>
                              <p className="mt-3 mb-2">
                                Edition: {contest.month}/{contest.year}
                              </p>
                              <p className="mb-2">
                                Registration: {contest.entryFeeRequired ? `Paid (NGN ${Number(contest.registrationFeeNgn || 0).toLocaleString('en-NG')})` : 'Free'}
                              </p>
                              <p className="mb-3">Finale Venue: {contest.finale.venueName}</p>
                              <div className="d-flex flex-wrap gap-2">
                                <Link href={`/open-mic/${contest.slug}/apply`} className="theme-btn">
                                  Apply Now
                                  <i className="fa-solid fa-arrow-right-long" />
                                </Link>
                                <Link href={`/open-mic/${contest.slug}/enter`} className="theme-btn style-2">
                                  Submit Song
                                  <i className="fa-solid fa-arrow-right-long" />
                                </Link>
                                <Link href={`/open-mic/${contest.slug}`} className="theme-btn style-border">
                                  View Details
                                  <i className="fa-solid fa-arrow-right-long" />
                                </Link>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 d-flex flex-wrap gap-2">
                      <Link href="/open-mic/dashboard" className="theme-btn">
                        Open Artist Dashboard
                        <i className="fa-solid fa-arrow-right-long" />
                      </Link>
                      <Link href="/contact" className="theme-btn">
                        Partner / Sponsor
                        <i className="fa-solid fa-arrow-right-long" />
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
