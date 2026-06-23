import Link from "next/link"

export default function Pricing1() {
    return (
        <section className="pricing-section section-bg fix section-padding">
            <div className="left-shape">
                <img src="/assets/img/pricing-left-shape.png" alt="shape-img" />
            </div>
            <div className="right-shape">
                <img src="/assets/img/shape/pricing-right-shape.png" alt="shape-img" />
            </div>
            <div className="container">
                <div className="section-title-area mb-5">
                    <div className="section-title">
                        <span className="wow fadeInUp">PHOTO GALLERY</span>
                        <h2 className="wow fadeInUp" data-wow-delay=".3s">
                            Moments From Spotlight <br /> Across Stage and Screen
                        </h2>
                    </div>
                </div>
                <div className="row g-4">
                    <div className="col-xl-4 col-md-6 wow fadeInUp" data-wow-delay=".2s">
                        <div className="project-items">
                            <div className="project-image">
                                <img src="/assets/img/shape/yvonne-1.jpg" alt="Spotlight gallery image one" />
                               <div className="project-content">
                                    {/* <p>Creative Community</p> */}
                                    <h4>
                                        <Link href="/media">Yvonne Jegede visit to the House</Link>
                                    </h4>
                                    <Link href="/media" className="icon">
                                        <i className="fa-solid fa-arrow-right" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="col-xl-4 col-md-6 wow fadeInUp" data-wow-delay=".4s">
                        <div className="project-items">
                            <div className="project-image">
                                <img src="/assets/img/shape/yvonne-2.jpg" alt="Spotlight gallery image two" />
                                <div className="project-content">
                                    {/* <p>Creative Community</p> */}
                                    <h4>
                                        <Link href="/media">HouseMates Creatively Welcome Yvonne </Link>
                                    </h4>
                                    <Link href="/media" className="icon">
                                        <i className="fa-solid fa-arrow-right" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="col-xl-4 col-md-6 wow fadeInUp" data-wow-delay=".6s">
                        <div className="project-items">
                            <div className="project-image">
                                <img src="/assets/img/shape/attempt.png" alt="Spotlight gallery image three" />
                            <div className="project-content">
                                   
                                    <h4>
                                        <Link href="/media">Housemate performing at a Guinness World record event</Link>
                                    </h4>
                                    <Link href="/media" className="icon">
                                        <i className="fa-solid fa-arrow-right" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="col-xl-4 col-md-6 wow fadeInUp" data-wow-delay=".6s">
                        <div className="project-items">
                            <div className="project-image">
                                <img src="/assets/img/shape/cover.jpg" alt="Spotlight gallery image three" />
                            <div className="project-content">
                                    {/* <p>Broadcast Reach</p> */}
                                    <h4>
                                          <Link href="/media">Spotlight Artists Performance</Link>
                                    </h4>
                                    <Link href="/media" className="icon">
                                        <i className="fa-solid fa-arrow-right" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="col-xl-4 col-md-6 wow fadeInUp" data-wow-delay=".6s">
                        <div className="project-items">
                            <div className="project-image">
                                <img src="/assets/img/shape/visit.png" alt="Spotlight gallery image three" />
                            <div className="project-content">
                                    {/* <p>Spotlight Artists Performance</p> */}
                                    <h4>
                                        <Link href="/media">HouseMate Visit to Larry Gaaga</Link>
                                    </h4>
                                    <Link href="/media" className="icon">
                                        <i className="fa-solid fa-arrow-right" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="col-xl-4 col-md-6 wow fadeInUp" data-wow-delay=".6s">
                        <div className="project-items">
                            <div className="project-image">
                                <img src="/assets/img/shape/cover2.jpg" alt="Spotlight gallery image three" />
                            <div className="project-content">
                                    {/* <p>Broadcast Reach</p> */}
                                    <h4>
                                        <Link href="/media">Nollywood Legend: Fred Amata on Movie Set with Housemates</Link>
                                    </h4>
                                    <Link href="/media" className="icon">
                                        <i className="fa-solid fa-arrow-right" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}

