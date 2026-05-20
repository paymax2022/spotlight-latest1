'use client'
import { Autoplay, Navigation, Pagination } from "swiper/modules"
import { Swiper, SwiperSlide } from "swiper/react"

const swiperOptions = {
    modules: [Autoplay, Pagination, Navigation],
    speed: 1500,
    loop: true,
    autoplay: {
        delay: 1500,
        disableOnInteraction: false,
    },
    pagination: {
        el: ".dot-2",
        clickable: true,
    },
}

export default function Testimonial1() {
    return (
        <>
            <section className="testimonial-section section-padding fix">
                <div className="container">
                    <div className="testimonial-wrapper">
                        <div className="swiper testimonial-slider">
                            <Swiper {...swiperOptions} className="swiper-wrapper">
                                <SwiperSlide>
                                    <div className="testimonial-items">
                                        <div className="tesimonial-image bg-cover" style={{ backgroundImage: 'url("assets/img/supporters/gucci.jpeg")' }}>
                                            <div className="star">
                                                <i className="fas fa-star" />
                                                <i className="fas fa-star" />
                                                <i className="fas fa-star" />
                                                <i className="fas fa-star" />
                                                <i className="fas fa-star" />
                                                 <i className="fas fa-star" />
                                            </div>
                                        </div>
                                        <div className="testimonial-content">
                                            <div className="section-title">
                                                <span>Testimonials</span>
                                                <h2>Season 1 Contestant</h2>
                                            </div>
                                            <p className="mt-3 mt-md-0">
                                                Spotlight gave me more than a stage; it gave me direction. From vocal training to studio sessions, mentorship, and live performances, I discovered the discipline behind becoming a real artist. ”  </p>
                                            <div className="author-details">
                                                <h5>Ernest Okonia (Gucci)</h5>
                                                <span>Singer & Actor</span>
                                            </div>
                                        </div>
                                    </div>
                                </SwiperSlide>
                                <SwiperSlide>
                                    <div className="testimonial-items">
                                        <div className="tesimonial-image bg-cover" style={{ backgroundImage: 'url("assets/img/supporters/vanny.png")' }}>
                                            <div className="star">
                                                <i className="fas fa-star" />
                                                <i className="fas fa-star" />
                                                <i className="fas fa-star" />
                                                <i className="fas fa-star" />
                                                <i className="fas fa-star" />
                                            </div>
                                        </div>
                                        <div className="testimonial-content">
                                            <div className="section-title">
                                                <span>Testimonials</span>
                                                <h2>Spotlight Season 1 Winner </h2>
                                            </div>
                                            <p className="mt-3 mt-md-0">
                                                Through Spotlight, I experienced what real production feels like. I learned acting discipline, rehearsals, script interpretation, camera awareness, and teamwork on set</p>
                                            <div className="author-details">
                                                <h5>Vanessa Nwobosi</h5>
                                                <span>Actor</span>
                                            </div>
                                        </div>
                                    </div>
                                </SwiperSlide>
                                <SwiperSlide>
                                    <div className="testimonial-items">
                                        <div className="tesimonial-image bg-cover" style={{ backgroundImage: 'url("assets/img/supporters/abraham.png")' }}>
                                            <div className="star">
                                                <i className="fas fa-star" />
                                                <i className="fas fa-star" />
                                                <i className="fas fa-star" />
                                                <i className="fas fa-star" />
                                                <i className="fas fa-star" />
                                            </div>
                                        </div>
                                        <div className="testimonial-content">
                                            <div className="section-title">
                                                <span>Testimonials</span>
                                                <h2>Co-Founder </h2>
                                            </div>
                                            <p className="mt-3 mt-md-0">
                                                Spotlight has the potential to become a national vehicle for youth empowerment because it combines talent discovery, creative economy development, STEM, entrepreneurship, media exposure, and mentorship in one scalable platform        </p>
                                            <div className="author-details">
                                                <h5>Abraham Babarinde</h5>
                                                {/* <span>Co-Founder</span> */}
                                            </div>
                                        </div>
                                    </div>
                                </SwiperSlide>
                                <SwiperSlide>
                                    <div className="testimonial-items">
                                        <div className="tesimonial-image bg-cover" style={{ backgroundImage: 'url("assets/img/testimonial/01.jpg")' }}>
                                            <div className="star">
                                                <i className="fas fa-star" />
                                                <i className="fas fa-star" />
                                                <i className="fas fa-star" />
                                                <i className="fas fa-star" />
                                                <i className="fas fa-star" />
                                            </div>
                                        </div>
                                        <div className="testimonial-content">
                                            <div className="section-title">
                                                <span>Testimonials</span>
                                                <h2>Brand/Sponsorship Representative </h2>
                                            </div>
                                            <p className="mt-3 mt-md-0">
                                          Spotlight offers brands something deeper than visibility. It connects sponsors to youth culture, emotional storytelling, digital engagement, public voting, live events, and measurable community impact. </p>
                                            <div className="author-details">
                                                <h5>PayMax Mobile App</h5>
                                                <span>Corporate Partner</span>
                                            </div>
                                        </div>
                                    </div>
                                </SwiperSlide>
                            </Swiper>
                        </div>
                        <div className="swiper-dot-2">
                            <div className="dot-2" />
                        </div>
                    </div>
                </div>
            </section>
        </>
    )
}
