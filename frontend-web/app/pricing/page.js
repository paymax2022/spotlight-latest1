
import Layout from "@/components/layout/Layout"
import Link from "next/link"
export default function Pricing() {

    return (
        <>

            <Layout headerStyle={1} footerStyle={2} breadcrumbTitle="Pricing">
                <section className="pricing-section fix section-padding">
                    <div className="container">
                        <div className="pricing-wrapper">
                            <div className="section-title text-center">
                                <span className="wow fadeInUp">FLEXIBLE PRICING PLAN</span>
                                <h2 className="wow fadeInUp" data-wow-delay=".3s">
                                    We’ve Offered the best <br /> pricing for you
                                </h2>
                            </div>
                            <div className="tab-content">
                                <div id="monthly" className="tab-pane fade show active" role="tabpanel">
                                    <div className="row">
                                        <div className="col-xl-4 col-lg-6 col-md-6 wow fadeInUp" data-wow-delay=".3s">
                                            <div className="pricing-items">
                                                <div className="tag">
                                                    <h6>Basic Plan</h6>
                                                </div>
                                                <div className="pricing-header">
                                                    <h2>$149</h2>
                                                    <span>Par month</span>
                                                    <p>
                                                        Lnteger sapien nec sapien sollicitudin ultrices Cras tempor id lorem et
                                                    </p>
                                                </div>
                                                <ul className="pricing-list">
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        Branding and design Identity
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        Web site Marketing Solutions
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        Free 15 GB Linux Hosting
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        24/7 system Monitoring
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        unlimited Download Data
                                                    </li>
                                                </ul>
                                                <div className="pricing-button">
                                                    <p>Up to 10 users + 1.99 per user</p>
                                                    <Link href="/contact" className="pricing-btn mt-4">
                                                        choose Plan
                                                        <i className="fa-solid fa-arrow-right-long" />
                                                    </Link>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="col-xl-4 col-lg-6 col-md-6 wow fadeInUp" data-wow-delay=".5s">
                                            <div className="pricing-items active">
                                                <div className="tag">
                                                    <h6>Most Popular</h6>
                                                </div>
                                                <div className="pricing-header">
                                                    <h2>$179</h2>
                                                    <span>Par month</span>
                                                    <p>
                                                        Lnteger sapien nec sapien sollicitudin ultrices Cras tempor id lorem et
                                                    </p>
                                                </div>
                                                <ul className="pricing-list">
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        Branding and design Identity
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        Web site Marketing Solutions
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        Free 15 GB Linux Hosting
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        24/7 system Monitoring
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        unlimited Download Data
                                                    </li>
                                                </ul>
                                                <div className="pricing-button">
                                                    <p>Up to 10 users + 1.99 per user</p>
                                                    <Link href="/contact" className="pricing-btn mt-4">
                                                        choose Plan
                                                        <i className="fa-solid fa-arrow-right-long" />
                                                    </Link>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="col-xl-4 col-lg-6 col-md-6 wow fadeInUp" data-wow-delay=".7s">
                                            <div className="pricing-items">
                                                <div className="tag">
                                                    <h6>Premium</h6>
                                                </div>
                                                <div className="pricing-header">
                                                    <h2>$199</h2>
                                                    <span>Par month</span>
                                                    <p>
                                                        Lnteger sapien nec sapien sollicitudin ultrices Cras tempor id lorem et
                                                    </p>
                                                </div>
                                                <ul className="pricing-list">
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        Branding and design Identity
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        Web site Marketing Solutions
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        Free 15 GB Linux Hosting
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        24/7 system Monitoring
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        unlimited Download Data
                                                    </li>
                                                </ul>
                                                <div className="pricing-button">
                                                    <p>Up to 10 users + 1.99 per user</p>
                                                    <Link href="/contact" className="pricing-btn mt-4">
                                                        choose Plan
                                                        <i className="fa-solid fa-arrow-right-long" />
                                                    </Link>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div id="yearly" className="tab-pane fade" role="tabpanel">
                                    <div className="row">
                                        <div className="col-xl-4 col-lg-6 col-md-6">
                                            <div className="pricing-items">
                                                <div className="tag">
                                                    <h6>Basic Plan</h6>
                                                </div>
                                                <div className="pricing-header">
                                                    <h2>$149</h2>
                                                    <span>Par month</span>
                                                    <p>
                                                        Lnteger sapien nec sapien sollicitudin ultrices Cras tempor id lorem et
                                                    </p>
                                                </div>
                                                <ul className="pricing-list">
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        Branding and design Identity
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        Web site Marketing Solutions
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        Free 15 GB Linux Hosting
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        24/7 system Monitoring
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        unlimited Download Data
                                                    </li>
                                                </ul>
                                                <div className="pricing-button">
                                                    <p>Up to 10 users + 1.99 per user</p>
                                                    <Link href="/contact" className="pricing-btn mt-4">
                                                        choose Plan
                                                        <i className="fa-solid fa-arrow-right-long" />
                                                    </Link>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="col-xl-4 col-lg-6 col-md-6">
                                            <div className="pricing-items active">
                                                <div className="tag">
                                                    <h6>Most Popular</h6>
                                                </div>
                                                <div className="pricing-header">
                                                    <h2>$179</h2>
                                                    <span>Par month</span>
                                                    <p>
                                                        Lnteger sapien nec sapien sollicitudin ultrices Cras tempor id lorem et
                                                    </p>
                                                </div>
                                                <ul className="pricing-list">
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        Branding and design Identity
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        Web site Marketing Solutions
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        Free 15 GB Linux Hosting
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        24/7 system Monitoring
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        unlimited Download Data
                                                    </li>
                                                </ul>
                                                <div className="pricing-button">
                                                    <p>Up to 10 users + 1.99 per user</p>
                                                    <Link href="/contact" className="pricing-btn mt-4">
                                                        choose Plan
                                                        <i className="fa-solid fa-arrow-right-long" />
                                                    </Link>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="col-xl-4 col-lg-6 col-md-6">
                                            <div className="pricing-items">
                                                <div className="tag">
                                                    <h6>Premium</h6>
                                                </div>
                                                <div className="pricing-header">
                                                    <h2>$199</h2>
                                                    <span>Par month</span>
                                                    <p>
                                                        Lnteger sapien nec sapien sollicitudin ultrices Cras tempor id lorem et
                                                    </p>
                                                </div>
                                                <ul className="pricing-list">
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        Branding and design Identity
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        Web site Marketing Solutions
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        Free 15 GB Linux Hosting
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        24/7 system Monitoring
                                                    </li>
                                                    <li>
                                                        <i className="fa-solid fa-check" />
                                                        unlimited Download Data
                                                    </li>
                                                </ul>
                                                <div className="pricing-button">
                                                    <p>Up to 10 users + 1.99 per user</p>
                                                    <Link href="/contact" className="pricing-btn mt-4">
                                                        choose Plan
                                                        <i className="fa-solid fa-arrow-right-long" />
                                                    </Link>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

            </Layout>
        </>
    )
}