'use client';

import { useEffect, useState } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';

// RBAC helper for the Featured Placement console. Reads the cached admin user
// (same source as AdminSidebar / AdminRouteGuard) and exposes a permission
// check so pages can disable sensitive affordances. Server still enforces —
// this only prevents dead-end UI. Mirrors useMobilityPermissions in
// app/admin/mobility/_ui.tsx.
export function useFeaturedPermissions() {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setUser(JSON.parse(raw) as AuthUser);
    } catch {
      /* unauthenticated handled by route guard */
    }
  }, []);
  const can = (perms: string[]) => hasAnyPermission(user, perms);
  return { user, can };
}

// Permission keys for the placement module (kept here + in routeGuard).
export const FEATURED_PERMS = {
  review: ['placement.admin.review'],
  approve: ['placement.admin.approve'],
  reject: ['placement.admin.reject'],
  suspend: ['placement.admin.suspend'],
};
