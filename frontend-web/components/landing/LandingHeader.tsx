'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowIcon } from './Icons';
import { LOGO, siteNav } from './content';
import { useJoinDialog } from './JoinDialog';
import HeaderDrawer from '@/components/marketing/HeaderDrawer';

/**
 * The mock's own sticky chrome, kept instead of the shared template header so
 * this page can carry the type and colour system it was designed around. The
 * hamburger opens HeaderDrawer — the sliding modal drawer, in this page's
 * palette — which is the only route to sign in and register here.
 */
export default function LandingHeader() {
  const { open } = useJoinDialog();
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleMenu = () => setMenuOpen((current) => !current);
  const closeMenu = () => setMenuOpen(false);

  function joinTrigger(className: string | undefined, children: ReactNode) {
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
      <header className="header">
        <div className="nav-shell">
          <a className="brand" href="#top" aria-label="Spotlight home">
            <img src={LOGO} alt="Spotlight" width={200} height={72} />
          </a>
          <nav className="desktop-nav" aria-label="Main navigation">
            {siteNav.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>
          <div className="nav-actions">
            {joinTrigger('button small light', <>Find your Spotlight <ArrowIcon /></>)}
            <button
              type="button"
              className="menu-toggle"
              aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
              aria-controls="home-menu"
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
        id="home-menu"
        open={menuOpen}
        onClose={closeMenu}
        groups={[{ label: 'Explore', links: siteNav }]}
        action={joinTrigger('text-link', <>Find your Spotlight <ArrowIcon /></>)}
      />
    </>
  );
}
