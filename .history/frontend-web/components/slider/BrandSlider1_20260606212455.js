
'use client'
import { Autoplay, Navigation, Pagination } from "swiper/modules"
import { Swiper, SwiperSlide } from "swiper/react"

const swiperOptions = {
    modules: [Autoplay, Pagination, Navigation],
    spaceBetween: 30,
    speed: 1800,
    loop: true,
    centeredSlides: false,
    observer: true,
    observeParents: true,
    autoplay: {
        delay: 1,
        disableOnInteraction: false,
        pauseOnMouseEnter: false,
    },

    breakpoints: {
        1199: {
            slidesPerView: 5,
        },
        991: {
            slidesPerView: 4,
        },
        767: {
            slidesPerView: 3,
        },
        575: {
            slidesPerView: 2,
        },
        0: {
            slidesPerView: 1,
        },
    },
}
export default function BrandSlider1() {
    return (
        <>
            <Swiper
                {...swiperOptions}
                className="brand-slider"
                onSwiper={(swiper) => {
                    if (swiper?.autoplay && !swiper.autoplay.running) {
                        swiper.autoplay.start()
                    }
                }}
            >
                    <SwiperSlide>
                        <div className="brand-image">
                            <img src="/assets/img/slider/dstv.jpeg" alt="DSTV" />
                        </div>
                    </SwiperSlide>
                    <SwiperSlide>
                        <div className="brand-image">
                            <img src="/assets/img/slider/clicknaija.jpg" alt="CkickNaija" />
                        </div>
                    </SwiperSlide>
                    <SwiperSlide>
                        <div className="brand-image">
                            <img src="/assets/img/slider/frcn.jpeg" alt="FRCN" />
                        </div>
                    </SwiperSlide>
                    <SwiperSlide>
                        <div className="brand-image">
                            <img src="/assets/img/slider/FMACCE.png" alt="FMACCE" />
                        </div>
                    </SwiperSlide>
                    <SwiperSlide>
                        <div className="brand-image">
                            <img src="/assets/img/slider/waptv.jpeg" alt="WAP TV" />
                        </div>
                    </SwiperSlide>
                    <SwiperSlide>
                        <div className="brand-image">
                            <img src="/assets/img/slider/wazobia.jpg" alt="Wazobia" />
                        </div>
                    </SwiperSlide>
                    <SwiperSlide>
                        <div className="brand-image">
                            <img src="/assets/img/slider/women.jpeg" alt="Women" />
                        </div>
                    </SwiperSlide>
                    <SwiperSlide>
                        <div className="brand-image">
                            <img src="/assets/img/shape/ravetv.png" alt="RaveTV" />
                        </div>
                    </SwiperSlide>
                    <SwiperSlide>
                        <div className="brand-image">
                            <img src="/assets/img/brand.png" alt="brand-img" />
                        </div>
                    </SwiperSlide>
                    <SwiperSlide>
                        <div className="brand-image">
                            <img src="/assets/img/brand.png" alt="brand-img" />
                        </div>
                    </SwiperSlide>
            </Swiper>
        </>
    )
}
