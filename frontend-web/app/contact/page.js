import Layout from '@/components/layout/Layout';
import Link from 'next/link';

export const metadata = {
  title: 'Contact Spotlight | Partnerships and Program Inquiries',
  description:
    'Get in touch with Spotlight for sponsorships, institutional collaborations, program participation, and support.',
};

export default function Contact() {
  return (
    <Layout headerStyle={1} footerStyle={2} breadcrumbTitle="Contact Spotlight">
      <section className="contact-section fix section-padding">
        <div className="container">
          <div className="contact-wrapper-2">
            <div className="row g-4 align-items-center">
              <div className="col-lg-6">
                <div className="contact-left-items">
                  <div className="contact-info-area-2">
                    <div className="contact-info-items mb-4">
                      <div className="content">
                        <p>General Inquiries</p>
                        <h3>
                          <a href="mailto:hello@spotlightafrica.tv">hello@spotlightafrica.tv</a>
                        </h3>
                      </div>
                    </div>
                    <div className="contact-info-items mb-4">
                      <div className="content">
                        <p>Partnership Desk</p>
                        <h3>
                          <a href="mailto:partnerships@spotlightafrica.tv">partnerships@spotlightafrica.tv</a>
                        </h3>
                      </div>
                    </div>
                    <div className="contact-info-items border-none">
                      <div className="content">
                        <p>Call / WhatsApp</p>
                        <h3>
                          <a href="tel:+2340000000000">+234 000 000 0000</a>
                        </h3>
                      </div>
                    </div>
                  </div>

                  <div className="video-image">
                    <img src="/assets/img/video.jpg" alt="Spotlight media" />
                  </div>
                </div>
              </div>

              <div className="col-lg-6">
                <div className="contact-content">
                  <h2>Ready to Partner or Apply?</h2>
                  <p>
                    Share your request and our team will respond with the right next step for sponsorship, institutional collaboration, media partnership, or participant support.
                  </p>
                  <form action="#" className="contact-form-items">
                    <div className="row g-4">
                      <div className="col-lg-6 wow fadeInUp" data-wow-delay=".3s">
                        <div className="form-clt">
                          <span>Your name*</span>
                          <input type="text" name="name" placeholder="Your Name" />
                        </div>
                      </div>
                      <div className="col-lg-6 wow fadeInUp" data-wow-delay=".5s">
                        <div className="form-clt">
                          <span>Your Email*</span>
                          <input type="email" name="email" placeholder="Your Email" />
                        </div>
                      </div>
                      <div className="col-lg-12 wow fadeInUp" data-wow-delay=".7s">
                        <div className="form-clt">
                          <span>Request Type*</span>
                          <input type="text" name="requestType" placeholder="Sponsorship, Government Program, Talent Application..." />
                        </div>
                      </div>
                      <div className="col-lg-12 wow fadeInUp" data-wow-delay=".8s">
                        <div className="form-clt">
                          <span>Message*</span>
                          <textarea name="message" placeholder="Tell us what you need" />
                        </div>
                      </div>
                      <div className="col-lg-12 wow fadeInUp" data-wow-delay=".9s">
                        <button type="submit" className="theme-btn">
                          Send Message <i className="fa-solid fa-arrow-right-long" />
                        </button>
                      </div>
                    </div>
                  </form>

                  <div className="mt-4 d-flex flex-wrap gap-2">
                    <Link href="/services/corporate-sponsorship-activation" className="theme-btn">
                      Sponsor a Program <i className="fa-solid fa-arrow-right-long" />
                    </Link>
                    <Link href="/services/government-youth-empowerment-programs" className="theme-btn">
                      Government Partnership <i className="fa-solid fa-arrow-right-long" />
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
