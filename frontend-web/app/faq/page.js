import Accordion1 from '@/components/elements/Accordion1';
import Layout from '@/components/layout/Layout';
import Link from 'next/link';

export const metadata = {
  title: 'FAQ | Spotlight',
  description:
    'Frequently asked questions about Spotlight programs, participation, sponsorship, and partnerships.',
};

export default function Faq() {
  return (
    <Layout headerStyle={1} footerStyle={2} breadcrumbTitle="Spotlight FAQs">
      <section className="faq-section style-2 fix section-padding">
        <div className="right-shape">
          <img src="/assets/img/faq/right-shape.png" alt="shape-img" />
        </div>
        <div className="faq-shape-box">
          <div className="faq-shape">
            <img src="/assets/img/faq/shape.png" alt="shape-img" />
          </div>
        </div>
        <div className="container">
          <div className="faq-wrapper">
            <div className="row g-4">
              <div className="col-lg-6 wow fadeInUp" data-wow-delay=".4s">
                <div className="faq-image">
                  <img src="/assets/img/faq/season1-7.png" alt="faq-img" />
                </div>
              </div>
              <div className="col-lg-6">
                <div className="faq-content">
                  <div className="section-title">
                    <span className="wow fadeInUp">FAQ</span>
                    <h2 className="wow fadeInUp" data-wow-delay=".3s">
                      Answers to the Most Common Spotlight Questions
                    </h2>
                  </div>
                  <div className="faq-accordion mt-4 mt-md-0">
                    <Accordion1 />
                  </div>
                  <div className="mt-4">
                    <Link href="/contact" className="theme-btn">
                      Need More Help? Contact Us <i className="fa-solid fa-arrow-right-long" />
                    </Link>
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
