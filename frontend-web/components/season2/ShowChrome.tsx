'use client';

import Link from 'next/link';
import { useState } from 'react';
import HeaderDrawer from '@/components/marketing/HeaderDrawer';
import { ArrowIcon } from './Icons';
import { LOGO } from './content';

/**
 * Which programme's application routes this chrome is carrying. The defaults
 * are the reality show's; every other programme passes its own tagline and
 * programme link so the header, drawer and footer never advertise the wrong
 * show.
 */
export interface ApplicationChrome {
  brandTag?: string;
  programmeHref?: string;
  programmeLabel?: string;
  ctaLabel?: string;
  footerTag?: string;
}

/**
 * The Season 2 chrome, carried onto the application routes. It keeps the same
 * sticky header and drawer as the recap page but never opens the registration
 * panel: on these pages the next step is the form itself.
 */
export function ApplicationHeader({
  brandTag = 'REALITY TV SHOW',
  programmeHref = '/season-2',
  programmeLabel = 'The show',
  ctaLabel = 'Season 2',
}: ApplicationChrome = {}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleMenu = () => setMenuOpen((current) => !current);
  const closeMenu = () => setMenuOpen(false);
  const nav = [
    { href: programmeHref, label: programmeLabel },
    { href: '/apply', label: 'All programmes' },
    { href: '/my-applications', label: 'My applications' },
  ];

  return (
    <>
      <header className="site-header">
        <div className="wrap header-inner">
          <Link className="brand" href="/" aria-label="Spotlight home">
            <img src={LOGO} alt="Spotlight" width={200} height={72} />
            <small>{brandTag}</small>
          </Link>
          <nav aria-label="Application navigation">
            {nav.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <Link className="button light" href={programmeHref}>
              {ctaLabel} <ArrowIcon />
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
        groups={[{ label: 'Applications', links: nav }]}
      />
    </>
  );
}

export function ApplicationFooter({
  programmeHref = '/season-2',
  programmeLabel = 'Season 2',
  footerTag = 'SPOTLIGHT REALITY TV / APPLICATIONS',
}: ApplicationChrome = {}) {
  return (
    <footer>
      <div className="wrap">
        <span>{footerTag}</span>
        <div>
          <Link href={programmeHref}>{programmeLabel}</Link>
          <Link href="/apply">All programmes</Link>
          <Link href="/my-applications">My applications</Link>
          <Link href="/contact">Contact</Link>
          <a href="mailto:info@spotlightng.com">info@spotlightng.com</a>
        </div>
      </div>
    </footer>
  );
}
