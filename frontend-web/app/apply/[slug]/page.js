import Layout from '@/components/layout/Layout';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import ContestRegistrationWizard from '@/components/forms/ContestRegistrationWizard';
import StemContestApplicationWizard from '@/components/forms/StemContestApplicationWizard';
import RealityShowApply from '@/components/season2/RealityShowApply';
import SmePitchApply from '@/components/season2/SmePitchApply';
import AcademyApplyPage from '@/app/film-academy/apply/page';
import { programPageBySlug, programPages } from '@/src/data/programPages';
import { createClient } from '@/lib/supabase/server';
import '@/components/season2/season2.css';
import '@/components/season2/application.css';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const program = programPageBySlug[slug];
  if (!program) {
    return { title: 'Application Form | Spotlight' };
  }

  return {
    title: `${program.title} Application Form | Spotlight`,
    description: `Apply for ${program.title} and submit your participant details to Spotlight.`,
  };
}

export default async function ProgramApplicationPage({ params }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/apply/${slug}`)}`);
  }

  const program = programPageBySlug[slug];

  if (!program) {
    notFound();
  }

  // The reality show and the SME pitch contest are rebuilt on the Season 2 type
  // and colour system; the other programmes still use the shared template shell.
  if (program.slug === 'reality-tv-show') {
    return <RealityShowApply program={program} />;
  }

  if (program.slug === 'sme-pitch-contest') {
    return <SmePitchApply program={program} />;
  }

  return (
    <Layout headerStyle={1} footerStyle={2} breadcrumbTitle={`${program.title} Application`}>
      <section className="about-section section-padding fix bg-cover" style={{ backgroundImage: 'url("/assets/img/service/service-bg-2.jpg")' }}>
        <div className="container">
          <div className="service-details-wrapper">
            <div className="row g-4">
              <div className="col-12 col-lg-4">
                <div className="main-sidebar">
                  <div className="single-sidebar-widget">
                    <div className="wid-title">
                      <h3>Application Menu</h3>
                    </div>
                    <div className="widget-categories">
                      <ul>
                        {programPages.map((item) => (
                          <li className={item.slug === program.slug ? 'active' : ''} key={item.slug}>
                            <Link href={`/apply/${item.slug}`}>{item.menuTitle}</Link>
                            <i className="fa-solid fa-arrow-right-long" />
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="single-sidebar-widget">
                    <div className="wid-title">
                      <h3>Before You Submit</h3>
                    </div>
                    <div className="opening-category">
                      <ul>
                        <li>
                          <i className="fa-regular fa-circle-check" />
                          Ensure your contact details are correct
                        </li>
                        <li>
                          <i className="fa-regular fa-circle-check" />
                          Provide active portfolio or project links
                        </li>
                        <li>
                          <i className="fa-regular fa-circle-check" />
                          Watch your email for screening updates
                        </li>
                      </ul>
                    </div>
                  </div>

                  <div className="single-sidebar-image bg-cover" style={{ backgroundImage: 'url("/assets/img/service/post.jpg")' }}>
                    <div className="contact-text">
                      <div className="icon">
                        <i className="fa-solid fa-phone" />
                      </div>
                      <h4>Need help with this form?</h4>
                      <h5>
                        <Link href="/contact">Contact Spotlight</Link>
                      </h5>
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-12 col-lg-8">
                <div className="service-details-items">
                  {program.heroImage && program.slug !== 'film-academy' ? (
                    <div className="details-image">
                      <img src={program.heroImage} alt={program.title} />
                    </div>
                  ) : null}
                  <div className="details-content">
                    {program.slug === 'stem-contest' ? (
                      <StemContestApplicationWizard contestSlug={program.slug} />
                    ) : program.slug === 'film-academy' ? (
                      <AcademyApplyPage embedded />
                    ) : (
                      <ContestRegistrationWizard contestSlug={program.slug} />
                    )}
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
