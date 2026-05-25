import Layout from '@/components/layout/Layout';
import Link from 'next/link';
import { programPages } from '@/src/data/programPages';

export const metadata = {
  title: 'Apply / Register | Spotlight',
  description:
    'Choose a Spotlight service and complete the dedicated application form for Reality TV Show, STEM Contest, SME Pitch Contest, Open Mic Competition, or Film Academy.',
};

export default function ApplyPage() {
  return (
    <Layout headerStyle={1} footerStyle={2} breadcrumbTitle="Apply / Register">
      <section className="service-section fix section-padding">
        <div className="container">
          <div className="section-title text-center">
            <span className="wow fadeInUp">APPLICATION FORMS</span>
            <h2 className="wow fadeInUp" data-wow-delay=".3s">
              Select a Program Application
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
                        <Link href={`/apply/${program.slug}`}>{program.menuTitle}</Link>
                      </h4>
                      <p>{program.subtitle}</p>
                      <Link href={`/apply/${program.slug}`} className="theme-btn-2 mt-3">
                        Open Application Form
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
