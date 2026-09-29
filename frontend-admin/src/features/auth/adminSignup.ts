'use client';

import type {
  SignupMode,
  SignupPermissionOption,
  SignupRoleOption,
} from './adminSignupShared';

/**
 * Client wrappers for /api/admin/signup. All the authorization and provisioning
 * happens server-side — these only carry JSON and turn failures into Error
 * messages the panel can show.
 */

export interface AdminSignupOptions {
  enabled: boolean;
  mode: SignupMode;
  requiresCode: boolean;
  minPasswordLength: number;
  roles: SignupRoleOption[];
  permissions: SignupPermissionOption[];
  maxPermissionGrants?: number;
  message: string;
}

export interface CreateAdminAccountInput {
  email: string;
  password: string;
  fullName: string;
  roleSlug: string;
  permissionSlugs: string[];
  setupCode: string;
}

export interface CreateAdminAccountResult {
  user: { id: string; email: string };
  roleSlug: string;
  extraPermissions: string[];
  via: SignupMode;
  warnings: string[];
}

export async function fetchAdminSignupOptions(): Promise<AdminSignupOptions> {
  let res: Response;
  try {
    res = await fetch('/api/admin/signup', { method: 'GET', cache: 'no-store' });
  } catch {
    throw new Error('Could not reach the server.');
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload?.ok) {
    throw new Error(payload?.error || 'Could not load the signup form.');
  }
  return {
    enabled: Boolean(payload.enabled),
    mode: payload.mode as SignupMode,
    requiresCode: Boolean(payload.requiresCode),
    minPasswordLength: Number(payload.minPasswordLength) || 12,
    roles: Array.isArray(payload.roles) ? payload.roles : [],
    permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
    maxPermissionGrants: typeof payload.maxPermissionGrants === 'number' ? payload.maxPermissionGrants : undefined,
    message: typeof payload.message === 'string' ? payload.message : '',
  };
}

export async function createAdminAccount(input: CreateAdminAccountInput): Promise<CreateAdminAccountResult> {
  let res: Response;
  try {
    res = await fetch('/api/admin/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error('Could not reach the server.');
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload?.ok) {
    throw new Error(payload?.error || 'The account could not be created.');
  }
  return {
    user: payload.user,
    roleSlug: payload.roleSlug,
    extraPermissions: Array.isArray(payload.extraPermissions) ? payload.extraPermissions : [],
    via: payload.via as SignupMode,
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
  };
}
