'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowIcon } from './Icons';
import { LOGO, siteNav } from './content';
import { useJoinDialog } from './JoinDialog';
import { accountLinks, useHeaderMenu } from './useHeaderMenu';

/**
 * The mock's own sticky chrome, kept instead of the shared template header so
 * this page can carry the type and colour system it was designed around.
 */
export default function LandingHeader() {
  const { open } = useJoinDialog();
  const { menuOpen, toggleMenu, closeMenu, menuRef, toggleRef, signedIn, signOut } = useHeaderMenu();

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
            ref={toggleRef}
            type="button"
            className="menu-toggle"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            aria-controls="mobile-menu"
            aria-expanded={menuOpen}
            onClick={toggleMenu}
          >
            <span />
            <span />
          </button>
        </div>
      </div>
      <nav ref={menuRef} className="mobile-nav" id="mobile-menu" aria-label="Mobile navigation" hidden={!menuOpen}>
        {siteNav.map((item) => (
          <a key={item.href} href={item.href} onClick={closeMenu}>
            {item.label}
          </a>
        ))}
        {joinTrigger(undefined, 'Find your Spotlight ↗')}
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
