// Prescription oversight for the telemedicine admin console. Always live: there is no
// fixture mode, because a fixture "prescription" view would be indistinguishable from
// real clinical data. Routes: contracts/telemedicine-admin-prescriptions.openapi.yaml.
import { apiV1 } from '@/config/env';

function base(): string {
  return `${apiV1()}/telemedicine/admin/prescriptions`;
}

const JSON_HEADERS: Record<string, string> = { 'Content-Type': 'application/json' };

async function request<T>(path: string, init?: RequestInit): Promise<{ data: T; total?: number }> {
  const res = await fetch(`${base()}${path}`, { headers: JSON_HEADERS, ...init });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = String(j.error); } catch { /* ignore parse failure */ }
    throw new Error(msg);
  }
  const j = await res.json();
  return { data: (j?.data ?? j) as T, total: typeof j?.total === 'number' ? j.total : undefined };
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface RxSummary {
  issued_30d: number;
  pending_fulfilment: number;
  flagged: number;
  refills_pending: number;
  substitutions_pending: number;
}

export interface RxRow {
  id: string;
  source: 'doctor' | 'telemedicine';
  ref: string;
  doctor_id: string;
  doctor_name: string;
  patient_masked: string;
  diagnosis: string;
  status: string;
  item_count: number;
  flagged: boolean;
  issued_at: string | null;
  created_at: string;
}

export interface FulfilmentRow {
  id: string;
  prescription_id: string | null;
  prescription_ref: string;
  pharmacy_name: string;
  status: string;
  total_kobo: number;
  pending_substitutions: number;
  delivery_status: string;
  created_at: string;
}

export interface RefillRow {
  id: string;
  prescription_id: string | null;
  prescription_ref: string;
  doctor_name: string;
  patient_masked: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
}

export interface RxDetail extends RxRow {
  patient_id: string;
  patient: Record<string, unknown>;
  medications_text?: string;
  instructions?: string;
  items: { name: string; dosage: string; route: string; frequency: string; duration: string; notes: string }[];
  audit: { action: string; actor: 'doctor' | 'admin'; prev_status: string; new_status: string; detail: Record<string, unknown>; created_at: string }[];
  fulfilments: {
    id: string; pharmacy_name: string; status: string; total_kobo: number;
    deliveries: { status: string; courier: string; tracking_ref: string; eta: string | null; delivered_at: string | null }[];
    substitutes: { original_drug: string; substitute_drug: string; status: string; price_kobo: number }[];
  }[];
  refills: { id: string; status: string; created_at: string; reviewed_at: string | null }[];
}

export interface RxFilters {
  status?: string;
  doctor_id?: string;
  from?: string;
  to?: string;
  flagged?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface Page<T> { rows: T[]; total: number }

export async function getRxSummary(): Promise<RxSummary> {
  return (await request<RxSummary>('/summary')).data;
}

export async function listPrescriptions(f: RxFilters = {}): Promise<Page<RxRow>> {
  const r = await request<RxRow[]>(qs({ ...f }));
  return { rows: r.data ?? [], total: r.total ?? (r.data ?? []).length };
}

export async function listFulfilments(f: { status?: string; limit?: number; offset?: number } = {}): Promise<Page<FulfilmentRow>> {
  const r = await request<FulfilmentRow[]>(`/fulfilments${qs({ ...f })}`);
  return { rows: r.data ?? [], total: r.total ?? (r.data ?? []).length };
}

export async function listRefills(f: { status?: string; limit?: number; offset?: number } = {}): Promise<Page<RefillRow>> {
  const r = await request<RefillRow[]>(`/refills${qs({ ...f })}`);
  return { rows: r.data ?? [], total: r.total ?? (r.data ?? []).length };
}

export async function getPrescription(id: string): Promise<RxDetail> {
  return (await request<RxDetail>(`/${encodeURIComponent(id)}`)).data;
}

export async function flagPrescription(id: string, reason: string): Promise<{ id: string; flagged: boolean }> {
  return (await request<{ id: string; flagged: boolean }>(`/${encodeURIComponent(id)}/flag`, {
    method: 'POST', body: JSON.stringify({ reason }),
  })).data;
}

export async function unflagPrescription(id: string, note?: string): Promise<{ id: string; flagged: boolean }> {
  return (await request<{ id: string; flagged: boolean }>(`/${encodeURIComponent(id)}/unflag`, {
    method: 'POST', body: JSON.stringify({ note: note ?? '' }),
  })).data;
}
