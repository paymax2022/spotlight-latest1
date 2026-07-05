'use client';

import { useEffect, useState } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';

// Permission keys for the nutrition admin module (kept here + in routeGuard).
export const NUTRITION_PERMS = {
  manage: ['nutrition.admin.manage'],
  resolve: ['nutrition.admin.resolve'],
};

// Reads the cached admin user (same source as AdminSidebar / route guard) and
// exposes a permission check so pages can disable sensitive write affordances.
// Server still enforces — this only prevents dead-end UI. Mirrors
// useMobilityPermissions in app/admin/mobility/_ui.tsx.
export function useNutritionPermissions() {
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
