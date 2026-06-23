import Layout from '@/components/layout/Layout';
import Link from 'next/link';
import { programPages } from '@/src/data/programPages';

export const metadata = {
  title: 'Services | Spotlight Programs',
  description:
    'Explore Spotlight flagship programs: Reality TV show, STEM contest, SME Pitch Contest, Open Mic Competition, and Film Academy.',
};

export default function Service() {
  return (
    <Layout headerStyle={1} footerStyle={2} breadcrumbTitle="Services">
      <section className="service-section fix section-padding">
        <div className="container">
          <div className="section-title text-center">
            <span className="wow fadeInUp">OUR PROGRAMS</span>
            <h2 className="wow fadeInUp" data-wow-delay=".3s">
              Spotlight Program Menu
            </h2>
          </div>

          <div className="service-wrapper mb-0">
            <div className="row g-4">
              {programPages.map((program, index) => (
                <div className="col-xl-4 col-lg-6 col-md-6 wow fadeInUp" data-wow-delay={`.${(index % 3) * 2 + 3}s`} key={program.slug}>
                  <div className="service-box-items box-shadow">
                    <div className="icon">
                      <img src={program.icon} alt="icon-img" />
                    </div>
                    <div className="content">
                      <h4>
                        <Link href={`/service-details/${program.slug}`}>{program.title}</Link>
                      </h4>
                      <p>{program.subtitle}</p>
                      <Link href={`/service-details/${program.slug}`} className="theme-btn-2 mt-3">
                        Read More
                        <i className="fa-solid fa-arrow-right-long" />
                      </Link>
                      <Link href={`/apply/${program.slug}`} className="theme-btn-2 mt-3">
                        Apply Now
                        <i className="fa-solid fa-arrow-right-long" />
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
