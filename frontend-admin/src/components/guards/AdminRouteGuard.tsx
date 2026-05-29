'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { AuthUser } from '@/features/auth/rbac';
import { isRouteAllowed } from '@/features/auth/routeGuard';

export function AdminRouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
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
  }, [pathname, router]);

  if (!ready) return null;
  return <>{children}</>;
}
