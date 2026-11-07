'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

/** What the signed-in member's drawer lists, on every marketing header. */
export const accountLinks = [
  { label: 'My dashboard', href: '/user-dashboard' },
  { label: 'My applications', href: '/user-dashboard?tab=applications' },
];

/**
 * The state behind a marketing header's top-right drawer: open/closed, and
 * whether the visitor has a session. These pages carry their own chrome and
 * mount no auth provider, so the session is read from the browser client
 * directly — the drawer offers sign in / register until one exists, then the
 * account links and sign out.
 *
 * The panel is closed on Escape or on a click outside it, because it is the
 * only route to sign in on these pages and a stuck-open panel hides the page.
 */
export function useHeaderMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const toggleMenu = useCallback(() => setMenuOpen((current) => !current), []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (mounted) setSignedIn(!!data.session);
    });
    const { data: authState } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        if (mounted) setSignedIn(!!session);
      },
    );
    return () => {
      mounted = false;
      authState.subscription.unsubscribe();
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

  async function signOut() {
    await supabase.auth.signOut();
    closeMenu();
  }

  return { menuOpen, toggleMenu, closeMenu, menuRef, toggleRef, signedIn, signOut };
}
