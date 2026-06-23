import Layout from '@/components/layout/Layout';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ContestRegistrationWizard from '@/components/forms/ContestRegistrationWizard';
import StemContestApplicationWizard from '@/components/forms/StemContestApplicationWizard';
import { programPageBySlug, programPages } from '@/src/data/programPages';

export function generateMetadata({ params }) {
  const program = programPageBySlug[params.slug];
  if (!program) {
    return { title: 'Application Form | Spotlight' };
  }

  return {
    title: `${program.title} Application Form | Spotlight`,
    description: `Apply for ${program.title} and submit your participant details to Spotlight.`,
  };
}

export default function ProgramApplicationPage({ params }) {
  const program = programPageBySlug[params.slug];

  if (!program) {
    notFound();
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
                  <div className="details-image">
                    <img src={program.heroImage} alt={program.title} />
                  </div>
                  <div className="details-content">
                    {program.slug === 'stem-contest' ? (
                      <StemContestApplicationWizard contestSlug={program.slug} />
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
