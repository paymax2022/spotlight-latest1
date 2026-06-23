// ── Admin — Paymax Connect control-plane service ─────────────────────────────
// Mock by default (mirrors realtorAdminService). Flip with
// NEXT_PUBLIC_CONNECT_ADMIN_USE_MOCK=false to hit the live Go backend at
// /api/connect/admin/*. Read-only in Phase 0 (cases + audit + config views).

import { env } from '@/config/env';
import type { ConnectCase, ConnectAuditEntry } from '@/types/connectAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_CONNECT_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/connect/admin');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

// ─── Mock datasets ────────────────────────────────────────────────────────────
const CASES: ConnectCase[] = [
  { id: 'case_1', reporter_id: 'usr_a', subject_id: 'usr_b', type: 'harassment', source_ref: 'message:abc', status: 'open', severity: 'high', resolution: null, assigned_admin: null, notes: null, created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(), updated_at: new Date(Date.now() - 2 * 3_600_000).toISOString() },
  { id: 'case_2', reporter_id: 'usr_c', subject_id: 'usr_d', type: 'scam', source_ref: 'profile:xyz', status: 'investigating', severity: 'critical', resolution: null, assigned_admin: 'adm_1', notes: 'Possible romance-scam script', created_at: new Date(Date.now() - 26 * 3_600_000).toISOString(), updated_at: new Date(Date.now() - 5 * 3_600_000).toISOString() },
  { id: 'case_3', reporter_id: 'usr_e', subject_id: 'usr_f', type: 'underage', source_ref: null, status: 'resolved', severity: 'critical', resolution: 'banned', assigned_admin: 'adm_2', notes: 'Confirmed under-18 — banned', created_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), updated_at: new Date(Date.now() - 2 * 86_400_000).toISOString() },
];

const AUDIT: ConnectAuditEntry[] = [
  { id: 'a1', actor_id: 'adm_1', actor_role: 'admin', action: 'connect.case.update', entity_type: 'connect_case', entity_id: 'case_2', reason: null, created_at: new Date(Date.now() - 5 * 3_600_000).toISOString() },
  { id: 'a2', actor_id: 'usr_e', actor_role: null, action: 'connect.agegate.blocked_minor', entity_type: 'connect_age_gate', entity_id: 'usr_e', reason: null, created_at: new Date(Date.now() - 3 * 86_400_000).toISOString() },
  { id: 'a3', actor_id: 'usr_a', actor_role: null, action: 'connect.case.open', entity_type: 'connect_case', entity_id: 'case_1', reason: null, created_at: new Date(Date.now() - 2 * 3_600_000).toISOString() },
];

// ─── API ──────────────────────────────────────────────────────────────────────
export async function getCases(status?: string): Promise<ConnectCase[]> {
  if (USE_MOCK) { await delay(); return status ? CASES.filter((c) => c.status === status) : [...CASES]; }
  return getJson<ConnectCase[]>(`/cases${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}

export async function getAudit(): Promise<ConnectAuditEntry[]> {
  if (USE_MOCK) { await delay(); return [...AUDIT]; }
  return getJson<ConnectAuditEntry[]>('/audit');
}
