
'use client'
import { useEffect, useState } from "react"
import BackToTop from '../elements/BackToTop'
import Breadcrumb from './Breadcrumb'
import MouseCursor from "./MouseCursor"
import Offcanvas from "./Offcanvas"
import Search from "./Search"
import Footer1 from './footer/Footer1'
import Footer2 from './footer/Footer2'
import Footer3 from "./footer/Footer3"
import Footer4 from "./footer/Footer4"
import Header1 from "./header/Header1"
import Header2 from './header/Header2'
import Header3 from "./header/Header3"
import Header4 from "./header/Header4"

export default function Layout({
    headerStyle,
    footerStyle,
    onePageNav,
    breadcrumbTitle,
    breadcrumbClassName,
    breadcrumbPadding,
    children
}) {
    const [scroll, setScroll] = useState(0)

    const [isOffCanvas, setOffCanvas] = useState(false)
    const handleOffCanvas = () => setOffCanvas(!isOffCanvas)

    const [isSearch, setSearch] = useState(false)
    const handleSearch = () => setSearch(!isSearch)

    useEffect(() => {
        // wowjs is a legacy UMD library that breaks under Next's bundler: its
        // `this.WOW = ...` binds to the global, so the module namespace comes back
        // as { default: {} } and the old `new WOW.WOW()` threw "WOW.WOW is not a
        // constructor". Probe every shape the interop can produce — including
        // window.WOW, which is where it actually lands here — and no-op if none is
        // constructible: the scroll-reveal is cosmetic and must never crash the page.
        import('wowjs')
            .then((mod) => {
                const WOW = [mod?.WOW, mod?.default?.WOW, mod?.default, window.WOW]
                    .find((candidate) => typeof candidate === 'function')
                if (!WOW) return
                window.wow = new WOW({ live: false })
                window.wow.init()
            })
            .catch(() => { /* animation is non-critical */ })

        document.addEventListener("scroll", () => {
            const scrollCheck = window.scrollY > 100
            if (scrollCheck !== scroll) {
                setScroll(scrollCheck)
            }
        })
    }, [])
    return (
        <>
            <MouseCursor />
            <Offcanvas isOffCanvas={isOffCanvas} handleOffCanvas={handleOffCanvas} />

            {!headerStyle && <Header2 scroll={scroll} onePageNav={onePageNav} isOffCanvas={isOffCanvas} handleOffCanvas={handleOffCanvas} isSearch={isSearch} handleSearch={handleSearch} />}
            {headerStyle == 1 ? <Header1 scroll={scroll} onePageNav={onePageNav} isOffCanvas={isOffCanvas} handleOffCanvas={handleOffCanvas} isSearch={isSearch} handleSearch={handleSearch} /> : null}
            {headerStyle == 2 ? <Header2 scroll={scroll} onePageNav={onePageNav} isOffCanvas={isOffCanvas} handleOffCanvas={handleOffCanvas} isSearch={isSearch} handleSearch={handleSearch} /> : null}
            {headerStyle == 3 ? <Header3 scroll={scroll} onePageNav={onePageNav} isOffCanvas={isOffCanvas} handleOffCanvas={handleOffCanvas} isSearch={isSearch} handleSearch={handleSearch} /> : null}
            {headerStyle == 4 ? <Header4 scroll={scroll} onePageNav={onePageNav} isOffCanvas={isOffCanvas} handleOffCanvas={handleOffCanvas} isSearch={isSearch} handleSearch={handleSearch} /> : null}
            <Search isSearch={isSearch} handleSearch={handleSearch} />


            {breadcrumbTitle && (
                <Breadcrumb
                    breadcrumbTitle={breadcrumbTitle}
                    className={breadcrumbClassName}
                    headingPadding={breadcrumbPadding}
                />
            )}

            {children}

            {!footerStyle && < Footer1 />}
            {footerStyle == 1 ? < Footer1 /> : null}
            {footerStyle == 2 ? < Footer2 /> : null}
            {footerStyle == 3 ? < Footer3 /> : null}
            {footerStyle == 4 ? < Footer4 /> : null}

            <BackToTop />
        </>
    )
}
