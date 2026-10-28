// Telemedicine admin — HMO claims, pre-authorisations, fraud warnings and referrals.
// Live data only (no fixtures): every call hits /api/v1/telemedicine/admin/{claims,referrals}/*
// per contracts/telemedicine-admin-claims.openapi.yaml. Reads need
// telemedicine.admin.view; the two writes need telemedicine.admin.manage and are
// audited server-side. Patient identifiers arrive already masked.

import { apiV1 } from '@/config/env';

function adminBase(): string {
  return `${apiV1()}/telemedicine/admin`;
}
function headers(): Record<string, string> {
  return { 'Content-Type': 'application/json' };
}

async function failure(res: Response): Promise<Error> {
  let msg = `Request failed (${res.status})`;
  try {
    const j = await res.json();
    if (j?.error) msg = String(j.error);
  } catch { /* non-JSON error body */ }
  if (res.status === 403) msg = 'You do not have permission for this action.';
  return new Error(msg);
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { headers: headers() });
  if (!res.ok) throw await failure(res);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

async function getPage<T>(path: string, params: Record<string, string | number | boolean | undefined>): Promise<Page<T>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
  const res = await fetch(`${adminBase()}${path}?${qs.toString()}`, { headers: headers() });
  if (!res.ok) throw await failure(res);
  const j = await res.json();
  return { items: (j?.data ?? []) as T[], total: j?.total ?? 0, limit: j?.limit ?? 0, offset: j?.offset ?? 0 };
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, {
    method: 'POST',
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

export interface Page<T> { items: T[]; total: number; limit: number; offset: number }
export interface ListOpts { status?: string; q?: string; limit?: number; offset?: number }

// ── claims ────────────────────────────────────────────────────────────────

export interface HmoClaim {
  id: string; ref: string | null; doctor_id: string | null; doctor_user_id: string; doctor_name: string;
  patient_masked: string; appointment_id: string | null; status: string; amount_kobo: number;
  created_at: string; updated_at: string;
}
export interface AuditEntry { id: string; action: string; actor_id: string; note: string; created_at: string }
export interface HmoClaimDetail extends HmoClaim { detail: Record<string, unknown>; audit: AuditEntry[] }

export interface PreAuth {
  id: string; doctor_user_id: string; doctor_name: string; patient_masked: string; appointment_id: string | null;
  status: string; auth_code_present: boolean; amount_kobo: number; created_at: string; updated_at: string;
}
export interface PreAuthDetail extends PreAuth { detail: Record<string, unknown> }

export interface FraudWarning {
  id: string; doctor_user_id: string; doctor_name: string; severity: string; acknowledged: boolean;
  acknowledged_at: string | null; summary: string; created_at: string;
}

export interface ClaimsSummary {
  claims_total: number; claims_by_status: Record<string, number>; claims_amount_kobo: number;
  preauth_total: number; preauth_by_status: Record<string, number>;
  fraud_warnings_open: number; fraud_warnings_high_open: number;
}

export const getClaimsSummary = () => getJson<ClaimsSummary>('/claims/summary');
export const listClaims = (o: ListOpts = {}) => getPage<HmoClaim>('/claims/claims', { ...o });
export const getClaim = (id: string) => getJson<HmoClaimDetail>(`/claims/claims/${encodeURIComponent(id)}`);
export const reviewClaim = (id: string, note: string) =>
  postJson<HmoClaimDetail>(`/claims/claims/${encodeURIComponent(id)}/review`, { note });
export const listPreAuth = (o: ListOpts = {}) => getPage<PreAuth>('/claims/preauth', { ...o });
export const getPreAuth = (id: string) => getJson<PreAuthDetail>(`/claims/preauth/${encodeURIComponent(id)}`);
export const listFraudWarnings = (o: { acknowledged?: boolean; severity?: string; limit?: number; offset?: number } = {}) =>
  getPage<FraudWarning>('/claims/fraud-warnings', { ...o });
export const acknowledgeFraudWarning = (id: string) =>
  postJson<FraudWarning>(`/claims/fraud-warnings/${encodeURIComponent(id)}/acknowledge`);

// ── referrals ─────────────────────────────────────────────────────────────

export type ReferralKind = 'outgoing' | 'incoming' | 'opinions';
export interface Referral {
  id: string; kind: 'outgoing' | 'incoming' | 'opinion'; doctor_user_id: string; doctor_name: string;
  counterpart: string; patient_masked: string; status: string; reason: string; created_at: string; updated_at: string;
}
export interface ReferralDetail extends Referral { detail: Record<string, unknown> }
export interface ReferralsSummary {
  outgoing_total: number; outgoing_by_status: Record<string, number>;
  incoming_total: number; incoming_by_status: Record<string, number>;
  opinions_total: number; opinions_by_status: Record<string, number>;
}

export const getReferralsSummary = () => getJson<ReferralsSummary>('/referrals/summary');
export const listReferrals = (kind: ReferralKind, o: ListOpts = {}) => getPage<Referral>(`/referrals/${kind}`, { ...o });
export const getReferral = (kind: ReferralKind, id: string) =>
  getJson<ReferralDetail>(`/referrals/${kind}/${encodeURIComponent(id)}`);

export function formatNaira(kobo: number): string {
  return `₦${((kobo ?? 0) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
