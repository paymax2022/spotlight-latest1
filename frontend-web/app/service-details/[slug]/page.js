import Layout from '@/components/layout/Layout';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { programPageBySlug, programPages } from '@/src/data/programPages';

export function generateMetadata({ params }) {
  const program = programPageBySlug[params.slug];
  if (!program) {
    return { title: 'Service Details | Spotlight' };
  }

  return {
    title: `${program.title} | Spotlight Service Details`,
    description: program.subtitle,
  };
}

export default function ServiceDetailBySlug({ params }) {
  const program = programPageBySlug[params.slug];
  const hideProgramMedia = program?.slug === 'stem-contest';
  const applyHref = program?.slug === 'open-mic-competition' ? '/open-mic' : `/apply/${program?.slug}`;

  if (!program) {
    notFound();
  }

  return (
    <Layout headerStyle={1} footerStyle={2} breadcrumbTitle={null}>
      <section className="overflow-hidden">
        <img
          src={program.bannerImage || '/assets/img/shape/banner2.png'}
          alt={`${program.title} banner`}
          style={{ width: '100%', height: 'auto', maxHeight: '500px', objectFit: 'cover', objectPosition: 'center', display: 'block' }}
        />
      </section>
      <section className="about-section section-padding fix bg-cover" style={{ backgroundImage: 'url("/assets/img/service/service-bg-2.jpg")' }}>
        <div className="container">
          <div className="service-details-wrapper">
            <div className="row g-4">
              <div className="col-12 col-lg-4 order-2 order-md-1">
                <div className="main-sidebar">
                  <div className="single-sidebar-widget">
                    <div className="wid-title">
                      <h3>Program Menu</h3>
                    </div>
                    <div className="widget-categories">
                      <ul>
                        {programPages.map((item) => (
                          <li className={item.slug === program.slug ? 'active' : ''} key={item.slug}>
                            <Link href={`/service-details/${item.slug}`}>{item.menuTitle}</Link>
                            <i className="fa-solid fa-arrow-right-long" />
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="single-sidebar-widget">
                    <div className="wid-title">
                      <h3>Program Outcomes</h3>
                    </div>
                    <div className="opening-category">
                      <ul>
                        {program.outcomes.map((outcome) => (
                          <li key={outcome}>
                            <i className="fa-regular fa-circle-check" />
                            {outcome}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="single-sidebar-image bg-cover" style={{ backgroundImage: 'url("/assets/img/service/post.jpg")' }}>
                    <div className="contact-text">
                      <div className="icon">
                        <i className="fa-solid fa-phone" />
                      </div>
                      <h4>Need Program Support?</h4>
                      <h5>
                        <Link href="/contact">Contact Spotlight</Link>
                      </h5>
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-12 col-lg-8 order-1 order-md-2">
                <div className="service-details-items">
                  {program.heroImage && (
                    <div className="details-image" style={{ overflow: 'hidden', borderRadius: '8px' }}>
                      <img
                        src={program.heroImage}
                        alt={program.title}
                        style={{ width: '100%', height: '360px', objectFit: 'cover', objectPosition: 'center', display: 'block' }}
                      />
                    </div>
                  )}

                  <div className="details-content">
                    <h3>{program.title}</h3>
                    {program.intro.map((paragraph) => (
                      <p className="mt-3" key={paragraph}>
                        {paragraph}
                      </p>
                    ))}

                    <div className="details-video-items">
                      {!hideProgramMedia && (
                        <div className="video-thumb">
                          <img src={program.videoThumbImage || '/assets/img/service/details-video.jpg'} alt="Spotlight program media" />
                        </div>
                      )}
                      <div className="content">
                        <h4>Benefits With This Program</h4>
                        <ul className="list">
                          {program.benefits.map((benefit) => (
                            <li key={benefit}>
                              <i className="fa-regular fa-circle-check" />
                              {benefit}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <h3 className="mt-4">Program Delivery Process</h3>
                    {program.process.map((step) => (
                      <p className="mt-2" key={step}>
                        <i className="fa-solid fa-arrow-right-long" /> {step}
                      </p>
                    ))}

                    {!hideProgramMedia && (
                      <div className="image-area">
                        <div className="row g-4">
                          <div className="col-lg-6 col-md-6">
                            <div className="thumb">
                              <img src={program.gallery[0]} alt={`${program.title} visual 1`} />
                            </div>
                          </div>
                          <div className="col-lg-6 col-md-6">
                            <div className="thumb">
                              <img src={program.gallery[1]} alt={`${program.title} visual 2`} />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {program.mansionSection && (
                      <div className="mansion-section mt-5">
                        <h3>{program.mansionSection.heading}</h3>
                        {program.mansionSection.description.map((para) => (
                          <p className="mt-3" key={para}>{para}</p>
                        ))}
                        <h4 className="mt-4">What Our Reels Capture</h4>
                        <ul className="list mt-3">
                          {program.mansionSection.reelHighlights.map((reel) => (
                            <li key={reel}>
                              <i className="fa-regular fa-circle-check" />
                              {reel}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <h3 className="mt-5">Most Common Questions</h3>
                    {program.faqs.map((faq) => (
                      <div className="mt-3" key={faq.q}>
                        <h5>{faq.q}</h5>
                        <p className="mt-2">{faq.a}</p>
                      </div>
                    ))}

                    <div className="mt-4 d-flex flex-wrap gap-2">
                      <Link href={applyHref} className="theme-btn">
                        Apply / Register
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
