// Telemedicine admin — review moderation and review disputes. Live backend only
// (no fixtures): GET/POST /api/v1/telemedicine/admin/reviews/* — see
// contracts/telemedicine-admin-reviews.openapi.yaml and
// backend/internal/telemedadmin/reviews. Reads need telemedicine.admin.view,
// mutations telemedicine.admin.manage.

import { apiV1 } from '@/config/env';

export type ReviewSource = 'telemedicine' | 'doctor_module';
export type DisputeStatus = 'open' | 'upheld' | 'rejected';
export type DisputeKind = 'dispute' | 'removal_request' | 'report';

export interface ReviewsSummary {
  total_reviews: number;
  hidden_reviews: number;
  low_rated_visible: number;
  open_disputes: number;
  resolved_disputes_30d: number;
  reported_reviews: number;
}

export interface ReviewRecord {
  id: string;
  source: ReviewSource;
  doctor_id: string | null;
  doctor_user_id: string | null;
  doctor_name: string;
  patient_ref: string;
  appointment_id: string | null;
  rating: number | null;
  comment: string;
  hidden: boolean;
  hidden_reason: string | null;
  reported: boolean;
  open_disputes: number;
  created_at: string;
}

export interface ModerationEvent {
  action: string;
  reason: string;
  actor: string;
  at: string;
}

export interface DisputeRecord {
  id: string;
  kind: DisputeKind;
  status: DisputeStatus;
  reason: string | null;
  review_id: string | null;
  doctor_user_id: string;
  doctor_name: string;
  resolution_reason: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface ReviewDetail extends ReviewRecord {
  disputes: DisputeRecord[];
  history: ModerationEvent[];
}

export interface DisputeDetail extends DisputeRecord {
  review: ReviewRecord | null;
}

export interface Page<T> {
  rows: T[];
  total: number;
}

export interface ReviewFilter {
  source?: ReviewSource | '';
  rating?: number | '';
  hidden?: 'true' | 'false' | '';
  doctorId?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface DisputeFilter {
  status?: DisputeStatus | '';
  kind?: DisputeKind | '';
  limit?: number;
  offset?: number;
}

function base(): string {
  return `${apiV1()}/telemedicine/admin/reviews`;
}

async function call<T>(path: string, init?: RequestInit): Promise<{ data: T; total?: number }> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  let body: { data?: T; total?: number; error?: string } | null = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const fallback =
      res.status === 403 ? 'You do not have permission for this action.' : `Request failed (${res.status})`;
    throw new Error(body?.error || fallback);
  }
  return { data: (body?.data ?? ([] as unknown)) as T, total: body?.total };
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v) !== '') u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export async function getReviewsSummary(): Promise<ReviewsSummary> {
  return (await call<ReviewsSummary>('/summary')).data;
}

export async function listReviews(f: ReviewFilter = {}): Promise<Page<ReviewRecord>> {
  const r = await call<ReviewRecord[]>(
    `${qs({
      source: f.source,
      rating: f.rating,
      hidden: f.hidden,
      doctor_id: f.doctorId?.trim(),
      q: f.q?.trim(),
      limit: f.limit ?? 50,
      offset: f.offset ?? 0,
    })}`,
  );
  return { rows: r.data, total: r.total ?? r.data.length };
}

export async function getReview(source: ReviewSource, id: string): Promise<ReviewDetail> {
  return (await call<ReviewDetail>(`/${source}/${id}`)).data;
}

export async function hideReview(source: ReviewSource, id: string, reason: string): Promise<ReviewRecord> {
  return (await call<ReviewRecord>(`/${source}/${id}/hide`, { method: 'POST', body: JSON.stringify({ reason }) })).data;
}

export async function unhideReview(source: ReviewSource, id: string, reason: string): Promise<ReviewRecord> {
  return (await call<ReviewRecord>(`/${source}/${id}/unhide`, { method: 'POST', body: JSON.stringify({ reason }) })).data;
}

export async function listReviewDisputes(f: DisputeFilter = {}): Promise<Page<DisputeRecord>> {
  const r = await call<DisputeRecord[]>(
    `/disputes${qs({ status: f.status, kind: f.kind, limit: f.limit ?? 50, offset: f.offset ?? 0 })}`,
  );
  return { rows: r.data, total: r.total ?? r.data.length };
}

export async function getReviewDispute(id: string): Promise<DisputeDetail> {
  return (await call<DisputeDetail>(`/disputes/${id}`)).data;
}

export async function resolveReviewDispute(
  id: string,
  decision: 'upheld' | 'rejected',
  reason: string,
): Promise<DisputeRecord> {
  return (
    await call<DisputeRecord>(`/disputes/${id}/resolve`, { method: 'POST', body: JSON.stringify({ decision, reason }) })
  ).data;
}

export const SOURCE_LABEL: Record<ReviewSource, string> = {
  telemedicine: 'Consultation review',
  doctor_module: 'Doctor-app review',
};

export const KIND_LABEL: Record<DisputeKind, string> = {
  dispute: 'Dispute',
  removal_request: 'Removal request',
  report: 'Report',
};

export const ACTION_LABEL: Record<string, string> = {
  'telemedicine.admin.review.hidden': 'Hidden',
  'telemedicine.admin.review.unhidden': 'Restored',
  'telemedicine.admin.review_dispute.upheld': 'Dispute upheld',
  'telemedicine.admin.review_dispute.rejected': 'Dispute rejected',
};
