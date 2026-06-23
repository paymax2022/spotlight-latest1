import type { AuthUser } from '@/features/auth/rbac';
import { hasAnyPermission } from '@/features/auth/rbac';

const routePermissions: Array<{ prefix: string; permissions: string[] }> = [
  { prefix: '/admin/audit-logs', permissions: ['audit.logs.view'] },
  { prefix: '/admin/security-events', permissions: ['audit.logs.view'] },
  { prefix: '/admin/login-activity', permissions: ['audit.logs.view'] },
  { prefix: '/admin/permissions-matrix', permissions: ['permissions.view'] },
  { prefix: '/admin/permissions', permissions: ['permissions.view'] },
  { prefix: '/admin/roles', permissions: ['roles.view'] },
  { prefix: '/admin/rbac-settings', permissions: ['roles.view'] },
  { prefix: '/admin/users', permissions: ['users.view'] },
  { prefix: '/admin/merchant-onboarding', permissions: ['merchant.onboarding.view'] },
  // Multi-modal expansion: each mode page requires mobility.view to enter; the
  // sensitive in-page actions are additionally gated by mode-specific
  // mobility.*.manage permissions (see _ui MOBILITY_PERMS).
  { prefix: '/admin/mobility/parcels', permissions: ['mobility.view'] },
  { prefix: '/admin/mobility/bus', permissions: ['mobility.view'] },
  { prefix: '/admin/mobility/towing', permissions: ['mobility.view'] },
  { prefix: '/admin/mobility/movers', permissions: ['mobility.view'] },
  { prefix: '/admin/mobility/car-hire', permissions: ['mobility.view'] },
  { prefix: '/admin/mobility/business', permissions: ['mobility.view'] },
  { prefix: '/admin/mobility/events', permissions: ['mobility.view'] },
  { prefix: '/admin/mobility', permissions: ['mobility.view'] },
];

export function isRouteAllowed(pathname: string, user: AuthUser | null): boolean {
  if (!user) return false;
  for (const item of routePermissions) {
    if (pathname.startsWith(item.prefix)) {
      return hasAnyPermission(user, item.permissions);
    }
  }
  return true;
}
