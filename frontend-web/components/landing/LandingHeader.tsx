'use client';

import Link from 'next/link';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ArrowIcon } from './Icons';
import { LOGO, siteNav } from './content';
import { useJoinDialog } from './JoinDialog';

const accountLinks = [
  { label: 'My dashboard', href: '/user-dashboard' },
  { label: 'My applications', href: '/user-dashboard?tab=applications' },
];

/**
 * The mock's own sticky chrome, kept instead of the shared template header so
 * this page can carry the type and colour system it was designed around.
 */
export default function LandingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const { open } = useJoinDialog();
  const menuRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (mounted) setSignedIn(!!data.session);
    });
    const { data: authData } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        if (mounted) setSignedIn(!!session);
      },
    );
    return () => {
      mounted = false;
      authData.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !toggleRef.current?.contains(target)) closeMenu();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onClick);
    };
  }, [menuOpen, closeMenu]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    closeMenu();
  }

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
            onClick={() => setMenuOpen((current) => !current)}
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
            <button type="button" onClick={handleSignOut}>
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
