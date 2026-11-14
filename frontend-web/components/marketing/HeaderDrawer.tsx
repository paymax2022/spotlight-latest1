'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import DrawerEnhancement from './DrawerEnhancement';
import './header-drawer.css';

export type DrawerLink = { href: string; label: string };
export type DrawerGroup = { label: string; links: readonly DrawerLink[] };

/** What a signed-in member sees in the account group, on every marketing page. */
const ACCOUNT_LINKS = [
  { label: 'My dashboard', href: '/user-dashboard' },
  { label: 'My applications', href: '/user-dashboard?tab=applications' },
];

/**
 * The drawer behind a marketing header's hamburger: the same modal mechanism as
 * the template offcanvas — a panel that slides in from the right over a dimmed,
 * scroll-locked page, closed by its own button, the backdrop, Escape or any
 * link — painted with the host page's tokens and carrying that page's nav plus
 * the account group.
 *
 * These pages mount no auth provider, so the session is read from the browser
 * client directly: a visitor gets the sign in / create an account pair, a member
 * gets the account links and sign out.
 */
export default function HeaderDrawer({
  id,
  open,
  onClose,
  groups,
  action,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  groups: readonly DrawerGroup[];
  action?: ReactNode;
}) {
  const [signedIn, setSignedIn] = useState(false);
  const supabase = useMemo(() => createClient(), []);

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

  // Escape closes: the drawer covers the page it belongs to, and it is the only
  // route back for a keyboard user who opened it by accident.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  async function signOut() {
    await supabase.auth.signOut();
    onClose();
  }

  return (
    <>
      <DrawerEnhancement />
      <div
        className={`hdr-drawer__backdrop${open ? ' is-open' : ''}`}
        aria-hidden="true"
        data-drawer-dismiss="drawer"
        onClick={onClose}
      />
      <aside
        id={id}
        className={`hdr-drawer__panel${open ? ' is-open' : ''}`}
        aria-label="Site menu"
        inert={!open}
      >
        <div className="hdr-drawer__top">
          <p className="hdr-drawer__title">Menu</p>
          <button
            type="button"
            className="hdr-drawer__close"
            aria-label="Close menu"
            data-drawer-dismiss="drawer"
            onClick={onClose}
          >
            &times;
          </button>
        </div>

        {groups.map((group) => (
          <div key={group.label}>
            <p className="hdr-drawer__group">{group.label}</p>
            {group.links.map((link) => (
              <Link key={link.href} href={link.href} onClick={onClose}>
                {link.label}
              </Link>
            ))}
          </div>
        ))}

        <hr className="hdr-drawer__rule" />
        <p className="hdr-drawer__group">Account</p>
        {signedIn ? (
          <>
            {ACCOUNT_LINKS.map((link) => (
              <Link key={link.href} href={link.href} onClick={onClose}>
                {link.label}
              </Link>
            ))}
            <button type="button" className="hdr-drawer__signout" onClick={signOut}>
              Sign out
            </button>
          </>
        ) : (
          // A visitor's two calls to action, side by side at the foot of the
          // drawer: sign in, or create the account they do not have yet.
          <div className="hdr-drawer__ctas">
            <Link
              className="hdr-drawer__cta hdr-drawer__cta--primary"
              href="/login"
              onClick={onClose}
            >
              Sign in
            </Link>
            <Link className="hdr-drawer__cta" href="/login?tab=signup" onClick={onClose}>
              Create an account
            </Link>
          </div>
        )}

        {action && <div className="hdr-drawer__action">{action}</div>}
      </aside>
    </>
  );
}
