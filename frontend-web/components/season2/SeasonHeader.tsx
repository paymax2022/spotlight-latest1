'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import HeaderDrawer from '@/components/marketing/HeaderDrawer';
import { isDrawerOpen } from '@/components/marketing/DrawerEnhancement';
import { SITE_LINKS } from '@/components/marketing/site-links';
import { ArrowIcon } from './Icons';
import { LOGO, seasonNav } from './content';
import { useRegistrationPanel } from './RegistrationPanel';

/**
 * The season page's own sticky chrome, kept instead of the shared template
 * header so this page can carry the type and colour system it was designed
 * around. The hamburger opens HeaderDrawer — the sliding modal drawer, in this
 * page's palette — which is the route to sign in and register here, and it
 * carries the site's pages as well as the season's own sections because this
 * header is the only chrome on screen.
 *
 * Below 700px the section nav wraps onto a second row, so the header's height
 * changes with the viewport. Anchor jumps are aligned by `scroll-padding-top`,
 * which reads this element's measured height off <html>.
 */
export default function SeasonHeader() {
  const { open } = useRegistrationPanel();
  const [menuOpen, setMenuOpen] = useState(() => isDrawerOpen('drawer'));
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const sync = () => {
      document.documentElement.style.setProperty('--season-chrome-top', `${header.offsetHeight}px`);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const toggleMenu = () => setMenuOpen((current) => !current);
  const closeMenu = () => setMenuOpen(false);

  function registerTrigger(className: string, children: ReactNode) {
    return (
      <button
        type="button"
        className={className}
        onClick={(event) => {
          closeMenu();
          open(event.currentTarget);
        }}
      >
        {children}
      </button>
    );
  }

  return (
    <>
      <header className="site-header" ref={headerRef}>
        <div className="wrap header-inner">
          <Link className="brand" href="/" aria-label="Spotlight home">
            <img src={LOGO} alt="Spotlight" width={200} height={72} />
            <small>REALITY TV SHOW</small>
          </Link>
          <nav aria-label="Season navigation">
            {seasonNav.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>
          <div className="header-actions">
            {registerTrigger('button light', <>Register <ArrowIcon /></>)}
            <button
              type="button"
              className="menu-toggle"
              aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
              aria-controls="season-menu"
              aria-expanded={menuOpen}
              data-drawer-toggle="drawer"
              onClick={toggleMenu}
            >
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>
      <HeaderDrawer
        id="season-menu"
        open={menuOpen}
        onClose={closeMenu}
        groups={[{ label: 'The show', links: seasonNav }, { label: 'Spotlight', links: SITE_LINKS }]}
        action={registerTrigger('text-link', <>Register for Season 2 <ArrowIcon /></>)}
      />
    </>
  );
}
