'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { AuthUser } from '@/features/auth/rbac';
import { isRouteAllowed } from '@/features/auth/routeGuard';

// Public admin routes render WITHOUT a session. They live under app/admin/ so
// they inherit this guard; without this exemption the guard swallows the login
// form (returns null when no token) and no one can ever sign in.
const PUBLIC_ADMIN_ROUTES = ['/admin/login', '/admin/unauthorized'];

function isPublicAdminRoute(pathname: string): boolean {
  return PUBLIC_ADMIN_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function AdminRouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const isPublic = isPublicAdminRoute(pathname);

  useEffect(() => {
    if (isPublic) return; // login / unauthorized need no session
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      const token = localStorage.getItem('spotlight_admin_access_token');
      if (!raw || !token) {
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
      router.replace('/admin/login');
    }
  }, [pathname, router, isPublic]);

  if (isPublic) return <>{children}</>; // render login/unauthorized freely
  if (!ready) return null;
  return <>{children}</>;
}
