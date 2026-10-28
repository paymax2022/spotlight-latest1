// Telemedicine admin — clinician compliance. Live data only: every call reads or
// writes /api/v1/telemedicine/admin/compliance/* (contracts/
// telemedicine-admin-compliance.openapi.yaml). Reads need telemedicine.admin.view,
// suspend/reinstate need telemedicine.admin.manage; the backend enforces both.

import { apiV1 } from '@/config/env';

function base(): string {
  return `${apiV1()}/telemedicine/admin/compliance`;
}

function headers(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  return { 'Content-Type': 'application/json' };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base()}${path}`, { ...init, headers: headers() });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) msg = String(j.error);
    } catch { /* body was not JSON */ }
    throw new Error(msg);
  }
  const j = await res.json();
  return (j?.data ?? j) as T;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface Page<T> { items: T[]; total: number }

export interface ComplianceSummary {
  licences_expired: number;
  licences_expiring_30d: number;
  licences_expiring_90d: number;
  suspended: number;
  training_pending: number;
  training_completed: number;
  audit_events_7d: number;
}

export type LicenceBucket = 'all' | 'expired' | '30d' | '90d';

export interface LicenceRow {
  user_id: string;
  doctor_id: string | null;
  name: string;
  specialty: string;
  mdcn_number: string | null;
  licence_expiry: string;
  days_to_expiry: number;
  bucket: 'expired' | '30d' | '90d' | 'later';
  profile_status: string;
}

export interface SuspendedClinician {
  user_id: string;
  doctor_id: string | null;
  name: string;
  specialty: string;
  mdcn_number: string | null;
  licence_expiry: string | null;
  licence_expired: boolean;
  suspended_at: string | null;
  suspended_by: 'system' | 'admin' | null;
  reason: string | null;
}

export interface StatusChange { user_id: string; status: 'suspended' | 'approved'; audit_id: string }

export interface AuditEvent {
  id: string;
  user_id: string;
  user_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface TrainingRow {
  id: string;
  user_id: string;
  user_name: string | null;
  module_id: string;
  title: string | null;
  status: string;
  completed_at: string | null;
  age_days: number;
}

export interface QualityRow {
  user_id: string;
  user_name: string | null;
  score: number;
  period_label: string | null;
  updated_at: string;
}

export interface RecordAccessRow {
  id: string;
  user_id: string;
  user_name: string | null;
  patient_ref: string | null;
  action: string;
  created_at: string;
}

export interface DocAccessRow {
  id: string;
  doc_id: string;
  accessor_id: string;
  basis: string;
  accessed_at: string;
}

export interface Paging { limit: number; offset: number }

export const getComplianceSummary = () => request<ComplianceSummary>('/summary');

export const listLicences = (o: Paging & { bucket?: LicenceBucket; q?: string }) =>
  request<Page<LicenceRow>>(`/licences${qs({ bucket: o.bucket, q: o.q?.trim(), limit: o.limit, offset: o.offset })}`);

export const listSuspended = (o: Paging) =>
  request<Page<SuspendedClinician>>(`/suspended${qs({ limit: o.limit, offset: o.offset })}`);

export const suspendClinician = (userId: string, reason: string) =>
  request<StatusChange>(`/doctors/${encodeURIComponent(userId)}/suspend`, { method: 'POST', body: JSON.stringify({ reason }) });

export const reinstateClinician = (userId: string, reason: string) =>
  request<StatusChange>(`/doctors/${encodeURIComponent(userId)}/reinstate`, { method: 'POST', body: JSON.stringify({ reason }) });

export const listAudit = (o: Paging & { action?: string; userId?: string; from?: string; to?: string }) =>
  request<Page<AuditEvent>>(`/audit${qs({ action: o.action?.trim(), user_id: o.userId?.trim(), from: o.from, to: o.to, limit: o.limit, offset: o.offset })}`);

export const listTraining = (o: Paging & { status?: 'pending' | 'completed' | '' }) =>
  request<Page<TrainingRow>>(`/training${qs({ status: o.status, limit: o.limit, offset: o.offset })}`);

export const listQuality = (o: Paging) =>
  request<Page<QualityRow>>(`/quality${qs({ limit: o.limit, offset: o.offset })}`);

export const listRecordAccess = (o: Paging & { userId?: string; action?: string }) =>
  request<Page<RecordAccessRow>>(`/record-access${qs({ user_id: o.userId?.trim(), action: o.action?.trim(), limit: o.limit, offset: o.offset })}`);

export const listDocAccess = (o: Paging) =>
  request<Page<DocAccessRow>>(`/doc-access${qs({ limit: o.limit, offset: o.offset })}`);
