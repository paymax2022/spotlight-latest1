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
