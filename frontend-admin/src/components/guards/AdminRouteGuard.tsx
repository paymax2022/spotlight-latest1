'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { AuthUser } from '@/features/auth/rbac';
import { isRouteAllowed } from '@/features/auth/routeGuard';
import { startAdminSessionSync, syncAdminSession } from '@/features/auth/adminSession';

// Public admin routes render WITHOUT a session. They live under app/admin/ so
// they inherit this guard; without this exemption the guard swallows the login
// form (returns null when no token) and no one can ever sign in.
//
// Was also exempting /admin/competitions/participants (updates registration
// status) and /admin/voting/contestant/* (casts admin votes) — both mutate
// data, neither belongs here, and the sidebar itself gates the Participants
// link behind contest.create/contest.update, contradicting the guard treating
// it as public. Removed while fixing the unauthenticated-/admin-access report:
// middleware.ts is the real gate now (ADMIN_MIDDLEWARE_ENFORCE=1, see
// docs/adr/ADR-047), and its own public list only ever exempted login +
// unauthorized — these two were never actually reachable without a session
// once that's on, only inconsistent to leave listed here.
const PUBLIC_ADMIN_ROUTES: (string | RegExp)[] = [
  '/admin/login',
  '/admin/unauthorized',
];

function isPublicAdminRoute(pathname: string): boolean {
  return PUBLIC_ADMIN_ROUTES.some((p) => {
    if (p instanceof RegExp) return p.test(pathname);
    return pathname === p || pathname.startsWith(`${p}/`);
  });
}

export function AdminRouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const isPublic = isPublicAdminRoute(pathname);

  useEffect(() => {
    if (isPublic) return; // login / unauthorized need no session
    let cancelled = false;

    // Republish (refreshing if needed) the Supabase session onto the key the
    // service layer reads BEFORE rendering the page. Supabase access tokens live
    // one hour and nothing else rewrites that key, so without this the guard
    // waved operators into a console whose every request 401'd — see
    // features/auth/adminSession. Expiry is now a redirect to login, not a wall
    // of per-page fetch errors.
    (async () => {
      try {
        const raw = localStorage.getItem('spotlight_admin_user');
        if (!raw) {
          router.replace('/admin/login');
          return;
        }
        const live = await syncAdminSession();
        if (cancelled) return;
        if (!live) {
          router.replace('/admin/login');
          return;
        }
        const user = JSON.parse(raw) as AuthUser;
        if (!isRouteAllowed(pathname, user)) {
          router.replace('/admin/unauthorized');
          return;
        }
        setReady(true);
      } catch {
        if (!cancelled) router.replace('/admin/login');
      }
    })();

    return () => { cancelled = true; };
  }, [pathname, router, isPublic]);

  // Keep mirroring hourly refreshes for as long as the console is open, so a
  // session that goes stale while a page sits idle heals itself.
  useEffect(() => (isPublic ? undefined : startAdminSessionSync()), [isPublic]);

  if (isPublic) return <>{children}</>; // render login/unauthorized freely
  if (!ready) return null;
  return <>{children}</>;
}
