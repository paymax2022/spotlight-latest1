'use client'

import { Autoplay, EffectFade, Pagination } from "swiper/modules"
import { Swiper, SwiperSlide } from "swiper/react"

const heroSlides = [
    { src: "/assets/img/shape/flyer3.png", alt: "Spotlight flyer" },
    { src: "/assets/img/shape/cover.jpg", alt: "Spotlight banner one" },
    { src: "/assets/img/shape/search.png", alt: "Spotlight banner two" },
]

const swiperOptions = {
    modules: [Autoplay, Pagination, EffectFade],
    slidesPerView: 1,
    loop: true,
    effect: "fade",
    speed: 900,
    autoplay: {
        delay: 3500,
        disableOnInteraction: false,
        pauseOnMouseEnter: true,
    },
    pagination: {
        el: ".hero-image-pagination",
        clickable: true,
    },
}

export default function HeroImageSlider() {
    return (
        <>
            <Swiper {...swiperOptions} className="hero-image-slider">
                {heroSlides.map((slide) => (
                    <SwiperSlide key={slide.src}>
                        <img src={slide.src} alt={slide.alt} />
                    </SwiperSlide>
                ))}
            </Swiper>
            <div className="hero-image-pagination" />
        </>
    )
}
