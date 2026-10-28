// Telemedicine admin — support, disputes, safety and emergency queues.
// Live data only: GET/POST /api/v1/telemedicine/admin/{support,safety,emergencies}/*
// (backend/internal/telemedadmin/support, contract in
// contracts/telemedicine-admin-support.openapi.yaml). Reads need
// telemedicine.admin.view, mutations telemedicine.admin.manage. There is no
// fixture mode: an empty queue is shown as empty, a failure as an error.

import { apiV1 } from '@/config/env';

export type QueueKind =
  | 'ticket'
  | 'dispute'
  | 'call_dispute'
  | 'safety_issue'
  | 'emergency_case'
  | 'emergency_escalation';

export interface QueueItem {
  id: string;
  kind: QueueKind;
  ref: string;
  doctor_user_id: string;
  doctor_name: string;
  subject: string;
  category: string;
  severity: string;
  status: string;
  patient_ref: string;
  assignee_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface QueueMessage { id: string; author: 'doctor' | 'agent' | 'system' | string; body: string; created_at: string }
export interface QueueHistory { action: string; admin_id?: string; from?: string; to?: string; created_at: string }

export interface QueueDetail extends QueueItem {
  allowed_statuses: string[];
  body?: string;
  detail?: Record<string, unknown>;
  evidence?: unknown[];
  messages?: QueueMessage[];
  escalations?: QueueItem[];
  history: QueueHistory[];
}

export interface KindSummary { total: number; by_status: Record<string, number>; unassigned_open: number }
export type Summary = Record<QueueKind, KindSummary>;

export interface Facility { id: string; doctor_user_id: string; name: string; facility_type: string; location: Record<string, unknown> | null; created_at: string }

export interface QueueFilters {
  status?: string;
  severity?: string;
  category?: string;
  q?: string;
  assigned?: '' | 'unassigned' | 'me' | string;
  limit?: number;
  offset?: number;
}

interface KindMeta {
  path: string;
  label: string;
  statuses: string[];
  /** Kinds with a doctor-visible conversation thread. */
  reply: boolean;
  /** Statuses that still need an admin. */
  open: string[];
  /** Kinds an admin can assign. */
  assign: boolean;
}

export const KIND_META: Record<QueueKind, KindMeta> = {
  ticket: { path: 'support/tickets', label: 'Tickets', statuses: ['open', 'in_progress', 'resolved', 'closed'], reply: true, open: ['open', 'in_progress'], assign: true },
  dispute: { path: 'support/disputes', label: 'Disputes', statuses: ['open', 'under_review', 'awaiting_response', 'resolved', 'rejected'], reply: true, open: ['open', 'under_review', 'awaiting_response'], assign: true },
  call_dispute: { path: 'support/call-disputes', label: 'Call disputes', statuses: ['open', 'under_review', 'resolved', 'rejected'], reply: false, open: ['open', 'under_review'], assign: true },
  safety_issue: { path: 'safety/issues', label: 'Safety issues', statuses: ['open', 'acknowledged', 'investigating', 'closed'], reply: false, open: ['open', 'acknowledged', 'investigating'], assign: true },
  emergency_case: { path: 'emergencies/cases', label: 'Emergency cases', statuses: ['open', 'acknowledged', 'resolved'], reply: false, open: ['open', 'acknowledged'], assign: true },
  emergency_escalation: { path: 'emergencies/escalations', label: 'Escalations', statuses: ['initiated', 'notified', 'acknowledged', 'cancelled'], reply: false, open: ['initiated', 'notified'], assign: true },
};

/** Statuses after which nothing more is expected from an admin. */
export const TERMINAL_STATUSES = new Set(['closed', 'resolved', 'rejected', 'cancelled']);

function adminBase(): string {
  return `${apiV1()}/telemedicine/admin`;
}

const JSON_HEADERS: Record<string, string> = { 'Content-Type': 'application/json' };

async function failure(res: Response): Promise<Error> {
  if (res.status === 403) return new Error('You need the telemedicine.admin.manage permission to do this.');
  let msg = `Request failed (${res.status})`;
  try {
    const j = await res.json();
    if (j?.error && typeof j.error === 'string') msg = j.error;
  } catch { /* non-JSON error body */ }
  return new Error(msg);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${adminBase()}/${path}`, { ...init, headers: { ...JSON_HEADERS, ...(init?.headers ?? {}) } });
  if (!res.ok) throw await failure(res);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export async function listQueue(kind: QueueKind, f: QueueFilters = {}): Promise<{ items: QueueItem[]; total: number }> {
  const r = await request<{ items: QueueItem[] | null; total: number }>(
    `${KIND_META[kind].path}${qs({ status: f.status, severity: f.severity, category: f.category, q: f.q, assigned: f.assigned, limit: f.limit, offset: f.offset })}`,
  );
  return { items: r.items ?? [], total: r.total ?? 0 };
}

export async function getQueueItem(kind: QueueKind, id: string): Promise<QueueDetail> {
  return request<QueueDetail>(`${KIND_META[kind].path}/${encodeURIComponent(id)}`);
}

/** idempotencyKey makes a retried POST (network blip, double click) a no-op. */
export async function replyToItem(kind: QueueKind, id: string, body: string, idempotencyKey: string): Promise<QueueDetail> {
  return request<QueueDetail>(`${KIND_META[kind].path}/${encodeURIComponent(id)}/reply`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ body }),
  });
}

export async function setItemStatus(kind: QueueKind, id: string, status: string, note?: string): Promise<QueueDetail> {
  return request<QueueDetail>(`${KIND_META[kind].path}/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    body: JSON.stringify({ status, note: note?.trim() || undefined }),
  });
}

/** assigneeId omitted = assign to me; null = unassign. */
export async function assignItem(kind: QueueKind, id: string, assigneeId?: string | null): Promise<QueueDetail> {
  const body = assigneeId === undefined ? {} : { assignee_id: assigneeId };
  return request<QueueDetail>(`${KIND_META[kind].path}/${encodeURIComponent(id)}/assign`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function getSupportSummary(): Promise<Summary> {
  return request<Summary>('support/summary');
}

export async function listFacilities(q?: string): Promise<Facility[]> {
  return (await request<Facility[] | null>(`emergencies/facilities${qs({ q, limit: 50 })}`)) ?? [];
}

/** Items of one queue that still need an admin. */
export function openCount(kind: QueueKind, summary: KindSummary | undefined): number {
  if (!summary) return 0;
  return KIND_META[kind].open.reduce((n, st) => n + (summary.by_status[st] ?? 0), 0);
}
