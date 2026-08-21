import { env } from '@/config/env';
import type {
  ModuleAuditEntry,
  ModuleEnvironment,
  ModuleLifecycle,
  ModuleRegistry,
  ModuleStatus,
  PlatformModule,
} from '@/types/modules';

/**
 * Module registry admin API.
 *
 * Unlike the read-only console services that swallow errors and return null,
 * these surface a typed failure. Publishing a module changes what every user of
 * an environment sees, so "it silently did nothing" is not an acceptable outcome —
 * the caller must be able to tell the operator what happened and roll the UI back.
 */

export class ModuleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ModuleApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.apiBaseUrl}/admin/modules${path}`, {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    throw new ModuleApiError('Could not reach the server. Check your connection and try again.', 0);
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* a non-JSON body is handled by the status check below */
  }

  if (!res.ok) {
    const serverMsg = (payload as { error?: string } | null)?.error;
    // 403 is the common, actionable one: the operator lacks
    // platform.modules.manage. Say so rather than showing a generic failure.
    const message =
      res.status === 403
        ? 'You do not have permission to change module publication (platform.modules.manage).'
        : serverMsg || `Request failed (${res.status}).`;
    throw new ModuleApiError(message, res.status);
  }

  return ((payload as { data?: T })?.data ?? (payload as T)) as T;
}

export function listModules(): Promise<ModuleRegistry> {
  return request<ModuleRegistry>('');
}

export function setModuleVisibility(
  key: string,
  environment: ModuleEnvironment,
  status: ModuleStatus,
  note?: string,
): Promise<PlatformModule> {
  return request<PlatformModule>(`/${encodeURIComponent(key)}/visibility`, {
    method: 'PATCH',
    body: JSON.stringify({ environment, status, note }),
  });
}

export function setModuleLifecycle(
  key: string,
  lifecycle: ModuleLifecycle,
  note?: string,
): Promise<PlatformModule> {
  return request<PlatformModule>(`/${encodeURIComponent(key)}/lifecycle`, {
    method: 'PATCH',
    body: JSON.stringify({ lifecycle, note }),
  });
}

export function getModuleHistory(key: string): Promise<ModuleAuditEntry[]> {
  return request<ModuleAuditEntry[]>(`/${encodeURIComponent(key)}/history`);
}

// ─── Per-user module grants ──────────────────────────────────────────────────
//
// A grant opens a RESTRICTED module for one user who has not completed KYC. It does
// NOT lift money limits: wallet debits, transfers and escrow still obey the user's KYC
// tier server-side, so this is safe to delegate to support staff. Wording in the UI
// should keep saying so — an operator who believes this unlocks payments will grant it
// for the wrong reason.

export interface UserModuleGrant {
  module_key: string;
  active: boolean;
  expires_at?: string | null;
  revoked_at?: string | null;
  granted_by?: string | null;
  note?: string;
  created_at: string;
}

export function listUserGrants(userId: string): Promise<{ grants: UserModuleGrant[] }> {
  return request<{ grants: UserModuleGrant[] }>(`/users/${encodeURIComponent(userId)}/grants`);
}

export function grantUserModule(
  userId: string,
  moduleKey: string,
  opts?: { note?: string; expiresAt?: string | null },
): Promise<{ granted: string }> {
  return request<{ granted: string }>(`/users/${encodeURIComponent(userId)}/grants`, {
    method: 'POST',
    body: JSON.stringify({
      module_key: moduleKey,
      note: opts?.note,
      // Omitted entirely when absent — the API treats a missing expiry as permanent,
      // and sending null would be indistinguishable from "clear the expiry".
      ...(opts?.expiresAt ? { expires_at: opts.expiresAt } : {}),
    }),
  });
}

export function revokeUserModule(userId: string, moduleKey: string): Promise<{ revoked: string }> {
  return request<{ revoked: string }>(
    `/users/${encodeURIComponent(userId)}/grants/${encodeURIComponent(moduleKey)}`,
    { method: 'DELETE' },
  );
}
