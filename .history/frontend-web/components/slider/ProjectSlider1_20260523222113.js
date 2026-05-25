
'use client'
import Link from "next/link"
import { Autoplay, Navigation, Pagination } from "swiper/modules"
import { Swiper, SwiperSlide } from "swiper/react"

const swiperOptions = {
    modules: [Autoplay, Pagination, Navigation],
    spaceBetween: 30,
    speed: 1500,
    loop: true,
    autoplay: {
        delay: 1500,
        disableOnInteraction: false,
    },
    pagination: {
        el: ".dot-3",
        clickable: true,
    },
    breakpoints: {
        1199: {
            slidesPerView: 4,
        },
        991: {
            slidesPerView: 3,
        },
        767: {
            slidesPerView: 2,
        },
        650: {
            slidesPerView: 2,
        },

        575: {
            slidesPerView: 1,
        },

        0: {
            slidesPerView: 1,
        },
    },
}
export default function ProjectSlider1({ showDots }) {
    return (
        <>
            <div className="swiper project-slider pt-5">
                <Swiper {...swiperOptions} className="swiper-wrapper">
                    <SwiperSlide>
                        <div className="project-items">
                            <div className="project-image">
                                <img src="/assets/img/supporters/larry.jpg" alt="AY" />
                                <div className="project-content">
                                    <p>Larry Gagga</p>
                                    <h4>
                                        <Link href="/project-details">Gamma Music (CEO) / Spotlight Patron </Link>
                                    </h4>
                                    <Link href="/project-details" className="icon">
                                        <i className="fa-solid fa-arrow-right" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </SwiperSlide>
                    <SwiperSlide>
                        <div className="project-items">
                            <div className="project-image">
                                <img src="/assets/img/supporters/ay.jpg" alt="project-img" />
                                <div className="project-content">
                                    <p>Ayo Makun</p>
                                    <h4>
                                        <Link href="/project-details">Supporter</Link>
                                    </h4>
                                    <Link href="/project-details" className="icon">
                                        <i className="fa-solid fa-arrow-right" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </SwiperSlide>
                    <SwiperSlide>
                        <div className="project-items">
                            <div className="project-image">
                                <img src="/assets/img/supporters/faze.jpeg" alt="project-img" />
                                <div className="project-content">
                                    <p>Faze</p>
                                    <h4>
                                        <Link href="/project-details">Supporter</Link>
                                    </h4>
                                    <Link href="/project-details" className="icon">
                                        <i className="fa-solid fa-arrow-right" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </SwiperSlide>
                    <SwiperSlide>
                        <div className="project-items">
                            <div className="project-image">
                                <img src="/assets/img/supporters/william.jpg" alt="project-img" />
                                <div className="project-content">
                                    <p>William Benson</p>
                                    <h4>
                                        <Link href="/project-details">Supporter</Link>
                                    </h4>
                                    <Link href="/project-details" className="icon">
                                        <i className="fa-solid fa-arrow-right" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </SwiperSlide>
                    <SwiperSlide>
                        <div className="project-items">
                            <div className="project-image">
                                <img src="/assets/img/supporters/bucci.jpg" alt="project-img" />
                                <div className="project-content">
                                    <p>Bucci Franklin</p>
                                    <h4>
                                        <Link href="/project-details">Supporter</Link>
                                    </h4>
                                    <Link href="/project-details" className="icon">
                                        <i className="fa-solid fa-arrow-right" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </SwiperSlide>
                          <SwiperSlide>
                        <div className="project-items">
                            <div className="project-image">
                                <img src="/assets/img/shape/2baba.jpg" alt="project-img" />
                                <div className="project-content">
                                    <p>2n Baba</p>
                                    <h4>
                                        <Link href="/project-details">Supporter</Link>
                                    </h4>
                                    <Link href="/project-details" className="icon">
                                        <i className="fa-solid fa-arrow-right" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </SwiperSlide>
                    <SwiperSlide>
                        <div className="project-items">
                            <div className="project-image">
                                <img src="/assets/img/supporters/charles.jpg" alt="project-img" />
                                <div className="project-content">
                                    <p>Charles Okocha (Mr Alogrithm)</p>
                                    <h4>
                                        <Link href="/project-details">Supporter</Link>
                                    </h4>
                                    <Link href="/project-details" className="icon">
                                        <i className="fa-solid fa-arrow-right" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </SwiperSlide>
                    <SwiperSlide>
                        <div className="project-items">
                            <div className="project-image">
                                <img src="/assets/img/supporters/banks.jpg" alt="project-img" />
                                <div className="project-content">
                                    <p>Reekado Banks</p>
                                    <h4>
                                        <Link href="/project-details">Supporter</Link>
                                    </h4>
                                    <Link href="/project-details" className="icon">
                                        <i className="fa-solid fa-arrow-right" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </SwiperSlide>
                </Swiper>

                {showDots &&
                    <div className="swiper-dot-2">
                        <div className="dot-3" />
                    </div>
                }
            </div>
        </>
    )
}
