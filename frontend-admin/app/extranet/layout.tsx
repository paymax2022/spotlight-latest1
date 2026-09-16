'use client';

import { useEffect, useState, type PropsWithChildren } from 'react';
import { startAdminSessionSync, syncAdminSession } from '@/features/auth/adminSession';

/**
 * Keeps the hotelier extranet's Bearer token fresh.
 *
 * WHY THIS EXISTS: staysExtranetService reads the same one-shot
 * localStorage['spotlight_admin_access_token'] the admin console does, but these
 * pages live OUTSIDE app/admin/ and had no layout of their own — so they
 * inherited only the bare root layout and never met AdminRouteGuard, where the
 * token refresh lives. Supabase access tokens last 3600s and nothing else
 * rewrites that key, so an hour after sign-in every live extranet call would
 * 401, exactly as the crowdfunding console did.
 *
 * The gap is latent today: NEXT_PUBLIC_STAYS_USE_MOCK is unset and the service
 * uses the legacy mock-by-default pattern, so extranet serves fixtures and never
 * sends the header at all. This closes it BEFORE Stays goes live, rather than
 * rediscovering the same 401 from the hotelier side.
 *
 * Deliberately NOT AdminRouteGuard. That guard enforces the admin RBAC route
 * allowlist and bounces a missing session to /admin/login — an authorization
 * policy for admin operators. The extranet is object-scoped to the signed-in
 * hotelier's own property and has no login entry point of its own, so imposing
 * the admin one here would be inventing an auth policy this surface has never
 * had. This layout does the one thing the gap is about: make sure whatever token
 * the page sends is a live one.
 */
export default function ExtranetLayout({ children }: PropsWithChildren) {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Resolve the session BEFORE first render. Rendering children while the
    // refresh is still in flight would let their on-mount fetches go out under
    // the stale token — reproducing the very 401 this prevents.
    void syncAdminSession().finally(() => {
      if (!cancelled) setChecked(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Mirror hourly refreshes for as long as the extranet stays open, so a session
  // that goes stale while a page sits idle heals itself.
  useEffect(() => startAdminSessionSync(), []);

  if (!checked) return null;
  return <>{children}</>;
}
