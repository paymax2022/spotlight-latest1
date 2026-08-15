import { env } from '@/config/env';
import type { AuditFilters, GenericRow } from '@/types/audit';

function adminApiBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api');
}

function toQuery(filters: AuditFilters): string {
  const params = new URLSearchParams();
  const entries = Object.entries(filters || {});
  for (const [k, v] of entries) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (!s) continue;
    params.set(k, s);
  }
  return params.toString();
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export async function listAuditLogs(filters: AuditFilters): Promise<GenericRow[]> {
  const qs = toQuery(filters);
  const url = `${adminApiBase()}/admin/audit-logs${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { cache: 'no-store', headers: authHeaders() });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.logs)) return [];
  return payload.logs as GenericRow[];
}

export async function listLoginActivity(filters: AuditFilters): Promise<GenericRow[]> {
  const qs = toQuery(filters);
  const url = `${adminApiBase()}/admin/login-activity${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { cache: 'no-store', headers: authHeaders() });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.activity)) return [];
  return payload.activity as GenericRow[];
}

export async function listSecurityEvents(filters: AuditFilters): Promise<GenericRow[]> {
  const qs = toQuery(filters);
  const url = `${adminApiBase()}/admin/security-events${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { cache: 'no-store', headers: authHeaders() });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.events)) return [];
  return payload.events as GenericRow[];
}

export function buildAuditExportUrl(filters: AuditFilters): string {
  const qs = toQuery(filters);
  return `${adminApiBase()}/admin/audit-logs/export${qs ? `?${qs}` : ''}`;
}
