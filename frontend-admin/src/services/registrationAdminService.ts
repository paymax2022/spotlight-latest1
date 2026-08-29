/**
 * Registration / applicants admin data — the fourth console served over PATH A
 * (ADMIN CONSOLIDATION slice 5; see docs/adr/ADR-047-admin-console-consolidation-path-a.md).
 *
 * Its data has no Go module: applications live in frontend-web's Supabase-backed
 * registration store (registration/supabase-store — the real write path; see
 * the store-mismatch fix documented in that file's own header) and arrive via
 * /api/web-proxy, same shape as contests / scoring / open-mic.
 *
 * Both routes this calls (GET .../applications, POST .../applications/:id/review)
 * already do their own Bearer-JWT auth via assertAdminPermission(request,
 * 'applications:review') — nothing changed on the frontend-web side to make
 * this work, only a client + service on this side reaching it through the proxy.
 *
 * SCOPE: this ports the one applicant view frontend-web actually had — a flat,
 * contest-scoped applicants list (frontend-web/app/admin/(dashboard)/contests/
 * [slug]/applicants) — and additionally wires the review action
 * (approve/reject/shortlist/etc.), which existed as a working, auth-guarded API
 * route but had no admin UI anywhere calling it.
 */
import { webProxyBase } from '@/config/env';

export type ApplicationStatus =
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

export type RegistrationDraft = {
  id: string;
  reference: string;
  contestSlug: string;
  status: ApplicationStatus;
  role: string;
  userId?: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  formData: Record<string, unknown>;
  completionPercent: number;
  currentStep?: string;
  fraudFlags: string[];
};

export type RegistrationListFilters = {
  contestSlug?: string;
  status?: ApplicationStatus;
  paymentStatus?: 'pending' | 'paid' | 'failed' | 'waived';
  query?: string;
};

export type RegistrationReviewInput = {
  status: ApplicationStatus;
  note?: string;
  score?: number;
  fraudFlags?: string[];
  requestedFields?: string[];
};

function webBase(): string {
  return webProxyBase();
}

function authHeaders(json = false): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readJsonOrThrow(res: Response, label: string): Promise<Record<string, unknown>> {
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throw new Error(`${label} failed: 401 — sign in again.`);
  if (res.status === 403) throw new Error(`${label} failed: 403 — this account cannot review applications.`);
  if (!res.ok) throw new Error(`${label} failed: ${(json.error as string) || res.status}`);
  return json;
}

export async function listRegistrationApplications(filters: RegistrationListFilters = {}): Promise<RegistrationDraft[]> {
  const params = new URLSearchParams();
  if (filters.contestSlug) params.set('contestSlug', filters.contestSlug);
  if (filters.status) params.set('status', filters.status);
  if (filters.paymentStatus) params.set('paymentStatus', filters.paymentStatus);
  if (filters.query) params.set('query', filters.query);
  const qs = params.toString();

  const res = await fetch(`${webBase()}/api/admin/registration/applications${qs ? `?${qs}` : ''}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const json = await readJsonOrThrow(res, 'Loading applications');
  return (json.applications as RegistrationDraft[]) ?? [];
}

export async function reviewRegistrationApplication(
  applicationId: string,
  input: RegistrationReviewInput,
): Promise<RegistrationDraft> {
  const res = await fetch(`${webBase()}/api/admin/registration/applications/${applicationId}/review`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(input),
  });
  const json = await readJsonOrThrow(res, 'Reviewing application');
  return json.draft as RegistrationDraft;
}
