'use client';

import { useEffect, useState } from 'react';
import Header1 from '@/components/layout/header/Header1';
import Offcanvas from '@/components/layout/Offcanvas';
import Search from '@/components/layout/Search';
import BackToTop from '@/components/elements/BackToTop';

/**
 * The site-wide template header (/service-details/sports uses the same
 * Header1 + Offcanvas + Search + BackToTop), rendered outside the .sp-season2
 * wrapper so season2.css's scoped element rules do not restyle it — mirroring
 * how <Layout> puts the header beside the .sports div, not inside it. The
 * season-specific nav lives in SeasonSubHeader, which stays scoped.
 */
export default function SeasonSiteChrome() {
  const [scroll, setScroll] = useState(false);
  const [isOffCanvas, setOffCanvas] = useState(false);
  const [isSearch, setSearch] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const next = window.scrollY > 100;
      setScroll((prev) => (prev === next ? prev : next));
    };
    onScroll();
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <Offcanvas isOffCanvas={isOffCanvas} handleOffCanvas={() => setOffCanvas((v) => !v)} />
      <Header1
        scroll={scroll}
        onePageNav={false}
        handleOffCanvas={() => setOffCanvas((v) => !v)}
        handleSearch={() => setSearch((v) => !v)}
      />
      {/* main.css makes #header-sticky position:fixed once scrolled, which drops
          it out of flow and yanks the page up by its own height mid-scroll —
          enough to hide the top of any section an anchor jump lands on. This
          spacer appears in the same render the class does, so the flow height
          never changes. */}
      {scroll && <div className="site-header-spacer" aria-hidden="true" />}
      <Search isSearch={isSearch} handleSearch={() => setSearch((v) => !v)} />
      <BackToTop />
    </>
  );
}
