// ── Admin — registration review queue (participants & entries) ───────────────
// Talks to the Go backend at /api/v1/admin/registrations. Approving an entry
// promotes it onto the voting roster server-side, in the same transaction as
// the status change, so the admin never has to do a second call to publish a
// contestant.
//
// This deliberately does NOT read Supabase REST directly: the status change is
// a guarded, audited, transactional operation, and going straight to the table
// would skip the RBAC check, the audit event and the promotion.

import { apiV1 } from '@/config/env';

export type RegistrationStatus =
  | 'draft'
  | 'submitted'
  | 'awaiting_payment'
  | 'under_review'
  | 'more_information_requested'
  | 'shortlisted'
  | 'callback_invited'
  | 'approved'
  | 'rejected'
  | 'waitlisted'
  | 'disqualified'
  | 'audition_scheduled'
  | 'selected_for_bootcamp'
  | 'selected_for_public_voting'
  | 'eliminated'
  | 'winner'
  | 'withdrawn';

export interface AdminRegistration {
  id: string;
  reference: string;
  userId: string | null;
  contestSlug: string;
  status: RegistrationStatus;
  formData: Record<string, unknown>;
  completionPercent: number;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  /** Set once the entry has been promoted onto the voting roster. */
  contestantId: string | null;
}

export interface RegistrationStatusEvent {
  id: string;
  oldStatus: string | null;
  newStatus: string;
  note: string | null;
  actorRole: string | null;
  createdAt: string;
}

export interface StatusChangeResult {
  registration: AdminRegistration;
  oldStatus: string;
  contestantId: string | null;
  promoted: boolean;
  removed: boolean;
}

export interface ListParams {
  status?: string;
  contestSlug?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

/** Statuses that place an entry on the voting roster (mirrors the backend). */
export const PROMOTABLE_STATUSES: RegistrationStatus[] = [
  'approved',
  'selected_for_public_voting',
  'selected_for_bootcamp',
];

function base(): string {
  return apiV1();
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

/** Surfaces the backend's own error text — "missing permission: contestant.approve"
 *  is far more actionable than "Request failed (403)". */
async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === 'string' && body.error.trim()) return body.error;
  } catch {
    /* non-JSON body */
  }
  if (res.status === 401) return 'Your admin session has expired. Sign in again.';
  if (res.status === 403) return 'You do not have permission to perform this action.';
  return `Request failed (${res.status})`;
}

export async function listRegistrations(
  params: ListParams = {},
): Promise<{ items: AdminRegistration[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.contestSlug) qs.set('contestSlug', params.contestSlug);
  if (params.search) qs.set('search', params.search);
  qs.set('limit', String(params.limit ?? 100));
  qs.set('offset', String(params.offset ?? 0));

  const res = await fetch(`${base()}/admin/registrations?${qs}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const body = await res.json();
  return { items: (body?.data ?? []) as AdminRegistration[], total: Number(body?.total ?? 0) };
}

export async function getRegistration(
  id: string,
): Promise<{ registration: AdminRegistration; statusEvents: RegistrationStatusEvent[] }> {
  const res = await fetch(`${base()}/admin/registrations/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const body = await res.json();
  return {
    registration: body?.data?.registration as AdminRegistration,
    statusEvents: (body?.data?.statusEvents ?? []) as RegistrationStatusEvent[],
  };
}

export async function updateRegistrationStatus(
  id: string,
  status: RegistrationStatus,
  note?: string,
): Promise<StatusChangeResult> {
  const res = await fetch(`${base()}/admin/registrations/${id}/status`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status, note: note ?? '' }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const body = await res.json();
  return body?.data as StatusChangeResult;
}

/** Best-effort display name from the wizard's flat form_data map. */
export function participantName(reg: AdminRegistration): string {
  const f = reg.formData ?? {};
  const first = String(f['personal.firstName'] ?? '').trim();
  const last = String(f['personal.lastName'] ?? '').trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  return String(f['personal.stageName'] ?? '').trim() || 'Unknown';
}

export function participantEmail(reg: AdminRegistration): string {
  const f = reg.formData ?? {};
  return String(f['account.email'] ?? f['personal.email'] ?? '').trim();
}
