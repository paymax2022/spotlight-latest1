'use client';

import { useEffect, useState } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';

// Permission keys for the vendor-oversight module. The estate vendor endpoints
// are gated estate-object-side (assertEstateAdmin); the closest admin-console
// capability is estate.manage (the estate section uses it, see AdminSidebar
// '/admin/estate/vendors'). Reuse it so a single estate-admin grant lights up
// both the estate workspace and this cross-estate oversight view.
export const VENDOR_PERMS = {
  view: ['estate.manage', 'estate.admin'],
  manage: ['estate.manage'], // verify/suspend a vendor
};

// Reads the cached admin user (same source as AdminSidebar / route guard) and
// exposes a permission check so pages can disable write affordances. Server
// stays authoritative. Mirrors useNutritionPermissions in app/admin/nutrition/_ui.tsx.
export function useVendorPermissions() {
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
