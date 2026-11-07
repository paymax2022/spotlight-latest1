'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useRegistrationPanel } from './RegistrationPanel';
import { ArrowIcon } from './Icons';
import { LOGO, seasonNav } from './content';
import { accountLinks, useHeaderMenu } from '@/components/landing/useHeaderMenu';

/**
 * The mock's own sticky chrome, kept instead of the shared template header so
 * this page can carry the type and colour system it was designed around.
 */
export default function SeasonHeader() {
  const { open } = useRegistrationPanel();
  const { menuOpen, toggleMenu, closeMenu, menuRef, toggleRef, signedIn, signOut } = useHeaderMenu();

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
            ref={toggleRef}
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
      <nav
        ref={menuRef}
        className="mobile-nav"
        id="season-menu"
        aria-label="Season menu"
        hidden={!menuOpen}
      >
        {seasonNav.map((item) => (
          <a key={item.href} href={item.href} onClick={closeMenu}>
            {item.label}
          </a>
        ))}
        {registerTrigger('text-link', <>Register for Season 2 <ArrowIcon /></>)}
        <hr className="nav-rule" />
        <p className="nav-group">Account</p>
        {signedIn ? (
          <>
            {accountLinks.map((item) => (
              <Link key={item.href} href={item.href} onClick={closeMenu}>
                {item.label}
              </Link>
            ))}
            <button type="button" onClick={signOut}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <Link href="/login" onClick={closeMenu}>
              Sign in
            </Link>
            <Link href="/login?tab=signup" onClick={closeMenu}>
              Create an account
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
