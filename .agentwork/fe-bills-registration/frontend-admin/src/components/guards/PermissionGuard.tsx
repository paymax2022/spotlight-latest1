'use client';

import type { PropsWithChildren, ReactNode } from 'react';
import { hasPermission, type AuthUser } from '@/features/auth/rbac';

type Props = PropsWithChildren<{ user: AuthUser | null; permission: string; fallback?: ReactNode }>;

export function PermissionGuard({ user, permission, fallback = null, children }: Props) {
  if (!hasPermission(user, permission)) return <>{fallback}</>;
  return <>{children}</>;
}
