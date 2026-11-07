'use client';

import Link from 'next/link';
import { useState } from 'react';
import HeaderDrawer from '@/components/marketing/HeaderDrawer';
import { ArrowIcon } from './Icons';
import { LOGO } from './content';

const APPLICATION_NAV = [
  { href: '/season-2', label: 'The show' },
  { href: '/apply', label: 'All programmes' },
  { href: '/my-applications', label: 'My applications' },
] as const;

/**
 * The Season 2 chrome, carried onto the application routes. It keeps the same
 * sticky header and drawer as the recap page but never opens the registration
 * panel: on these pages the next step is the form itself.
 */
export function ApplicationHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleMenu = () => setMenuOpen((current) => !current);
  const closeMenu = () => setMenuOpen(false);

  return (
    <>
      <header className="site-header">
        <div className="wrap header-inner">
          <Link className="brand" href="/" aria-label="Spotlight home">
            <img src={LOGO} alt="Spotlight" width={200} height={72} />
            <small>REALITY TV SHOW</small>
          </Link>
          <nav aria-label="Application navigation">
            {APPLICATION_NAV.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <Link className="button light" href="/season-2">
              Season 2 <ArrowIcon />
            </Link>
            <button
              type="button"
              className="menu-toggle"
              aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
              aria-controls="application-menu"
              aria-expanded={menuOpen}
              onClick={toggleMenu}
            >
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>
      <HeaderDrawer
        id="application-menu"
        open={menuOpen}
        onClose={closeMenu}
        groups={[{ label: 'Applications', links: APPLICATION_NAV }]}
      />
    </>
  );
}

export function ApplicationFooter() {
  return (
    <footer>
      <div className="wrap">
        <span>SPOTLIGHT REALITY TV / APPLICATIONS</span>
        <div>
          <Link href="/season-2">Season 2</Link>
          <Link href="/apply">All programmes</Link>
          <Link href="/my-applications">My applications</Link>
          <Link href="/contact">Contact</Link>
          <a href="mailto:info@spotlightng.com">info@spotlightng.com</a>
        </div>
      </div>
    </footer>
  );
}
