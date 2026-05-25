import CounterUp from '@/components/elements/CounterUp';
import Layout from '@/components/layout/Layout';
import Link from 'next/link';

export const metadata = {
  title: 'About Spotlight | Youth Empowerment and Creative Economy Platform',
  description:
    'Learn about Spotlight and how our talent, innovation, and media ecosystem drives measurable youth empowerment outcomes.',
};

const pillars = [
  'Talent discovery and structured development pipelines',
  'Creative economy growth across music, film, and digital media',
  'STEM and entrepreneurship opportunity pathways',
  'Sponsor and institutional impact programs with measurable outcomes',
];

export default function About() {
  return (
    <Layout headerStyle={1} footerStyle={2} breadcrumbTitle="About Spotlight">
      <section className="about-section section-padding fix bg-cover" style={{ backgroundImage: 'url("/assets/img/service/service-bg-2.jpg")' }}>
        <div className="container">
          <div className="about-wrapper style-2">
            <div className="row">
              <div className="col-lg-6">
                <div className="about-image-items">
                  <div className="circle-shape" style={{ animation: 'none' }}>
                    <img src="/assets/img/shape/covex.jpg" alt="shape-img" />
                  </div>
                  <div className="counter-shape float-bob-y">
                    <div className="icon">
                      <img src="/assets/img/about/icon-1.svg" alt="icon-img" />
                    </div>
                    <div className="content">
                      <h3>
                        <CounterUp count={25} />Years
                      </h3>
                      <p>of ecosystem building</p>
                    </div>
                  </div>
                  <div className="about-image-1 bg-cover wow fadeInLeft" style={{ backgroundImage: 'url("/assets/img/shape/visit.png")' }}>
                    <div className="about-image-2 wow fadeInUp" data-wow-delay=".5s">
                      <img src="/assets/img/shape/ring.png" alt="about-img" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-lg-6 mt-4 mt-lg-0">
                <div className="about-content">
                  <div className="section-title">
                    <span className="wow fadeInUp">ABOUT SPOTLIGHT</span>
                    <h2 className="wow fadeInUp" data-wow-delay=".3s">
                      Where talent meets <span>structure</span>, and creativity meets opportunity.
                    </h2>
                  </div>
                  <p className="mt-3 mt-md-0 wow fadeInUp" data-wow-delay=".5s">
                    Spotlight is a media-powered youth empowerment platform built to discover, train, showcase, and connect emerging talents and innovators to practical growth opportunities across the creative and innovation economy.
                  </p>

                  <div className="about-icon-items">
                    <div className="icon-items wow fadeInUp" data-wow-delay=".7s">
                      <div className="icon">
                        <img src="/assets/img/about/icon-4.svg" alt="icon-img" />
                      </div>
                      <div className="content">
                        <h4>Mission</h4>
                        <p>Build scalable pathways from potential to measurable opportunity.</p>
                      </div>
                    </div>
                    <div className="icon-items wow fadeInUp" data-wow-delay=".9s">
                      <div className="icon">
                        <img src="/assets/img/about/icon-5.svg" alt="icon-img" />
                      </div>
                      <div className="content">
                        <h4>Vision</h4>
                        <p>Become Africa&apos;s most trusted youth empowerment ecosystem.</p>
                      </div>
                    </div>
                  </div>

                  <div className="about-author">
                    <div className="about-button wow fadeInUp" data-wow-delay=".5s">
                      <Link href="/services" className="theme-btn">
                        Explore Services
                        <i className="fa-solid fa-arrow-right-long" />
                      </Link>
                    </div>
                    <div className="about-button wow fadeInUp" data-wow-delay=".7s">
                      <Link href="/sponsors-partners" className="theme-btn">
                        Partner With Spotlight
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

      <section className="offer-section fix section-padding">
        <div className="line-shape">
          <img src="/assets/img/team/line-shape.png" alt="shape-img" />
        </div>
        <div className="mask-shape">
          <img src="/assets/img/team/mask-shape.png" alt="shape-img" />
        </div>
        <div className="container">
          <div className="section-title text-center">
            <span className="wow fadeInUp">Core Focus</span>
            <h2 className="wow fadeInUp" data-wow-delay=".3s">
              Spotlight Platform Pillars
            </h2>
          </div>
          <div className="row g-4 mt-1">
            {pillars.map((pillar, index) => (
              <div className="col-xl-3 col-lg-6 col-md-6 wow fadeInUp" data-wow-delay={`.${index + 2}s`} key={pillar}>
                <div className="service-box-items box-shadow">
                  <div className="content">
                    <h4>{pillar}</h4>
                    <p>Integrated into our program, media, and partnership architecture.</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </Layout>
  );
}
