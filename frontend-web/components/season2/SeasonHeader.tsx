'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRegistrationPanel } from './RegistrationPanel';
import { ArrowIcon } from './Icons';
import { LOGO, seasonNav } from './content';
import HeaderDrawer from '@/components/marketing/HeaderDrawer';

/**
 * The mock's own sticky chrome, kept instead of the shared template header so
 * this page can carry the type and colour system it was designed around. The
 * hamburger opens HeaderDrawer — the sliding modal drawer, in this page's
 * palette — which is the only route to sign in and register here.
 */
export default function SeasonHeader() {
  const { open } = useRegistrationPanel();
  const [menuOpen, setMenuOpen] = useState(false);

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
      <header className="site-header">
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
        groups={[{ label: 'The show', links: seasonNav }]}
        action={registerTrigger('text-link', <>Register for Season 2 <ArrowIcon /></>)}
      />
    </>
  );
}
