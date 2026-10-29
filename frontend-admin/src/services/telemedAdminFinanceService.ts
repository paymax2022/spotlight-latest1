// Telemedicine admin — finance oversight (READ-ONLY). Live data only: there is no
// fixture mode, so an empty database shows empty states rather than invented
// numbers. Backend: GET /api/v1/telemedicine/admin/finance/* (permission
// telemedicine.admin.view), contract in contracts/telemedicine-admin-finance.openapi.yaml.
// Money is integer kobo throughout; nothing here moves or writes money.

import { apiV1 } from '@/config/env';

function financeBase(): string {
  return `${apiV1()}/telemedicine/admin/finance`;
}

async function getJson<T>(path: string, params?: Record<string, string | number | undefined | null>): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const url = `${financeBase()}${path}${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    if (res.status === 403) msg = 'You do not have permission to view telemedicine finance (telemedicine.admin.view).';
    else {
      try { const j = await res.json(); if (j?.error) msg = String(j.error); } catch { /* keep default */ }
    }
    throw new Error(msg);
  }
  const j = await res.json();
  return (j?.data ?? j) as T;
}

export function formatKobo(kobo: number | null | undefined): string {
  const naira = (kobo ?? 0) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type PayoutStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'reversed';

export interface PayoutStatusTotal { status: string; count: number; amount_kobo: number }
export interface FinanceSummary {
  currency: string;
  completed_consultations: number;
  gross_consult_fees_kobo: number;
  platform_commission_kobo: number;
  platform_booking_fees_kobo: number;
  doctor_net_kobo: number;
  payouts_by_status: PayoutStatusTotal[];
  open_disputes: number;
}
export interface BankAccountMasked { bank_name: string | null; account_last4: string | null; is_verified: boolean }
export interface Payout {
  id: string;
  doctor_user_id: string;
  doctor_name: string;
  ref: string | null;
  amount_kobo: number;
  currency: string;
  status: PayoutStatus;
  consult_count: number;
  period_label: string | null;
  failure_reason: string | null;
  requested_at: string;
  paid_at: string | null;
  bank_account: BankAccountMasked;
  open_disputes: number;
}
export interface Dispute {
  id: string;
  doctor_user_id: string;
  doctor_name: string;
  payout_id: string | null;
  status: string;
  reason: string | null;
  created_at: string;
  updated_at: string;
}
export interface PayoutDetail extends Payout {
  ledger_ref: string | null;
  provider_reference: string | null;
  disputes: Dispute[];
}
export interface DisputeDetail extends Dispute {
  detail: Record<string, unknown>;
  payout: Payout | null;
}
export interface DoctorEarnings {
  doctor_id: string;
  doctor_user_id: string;
  doctor_name: string;
  specialty: string;
  completed_consultations: number;
  gross_kobo: number;
  commission_kobo: number;
  platform_booking_fees_kobo: number;
  net_kobo: number;
  paid_out_kobo: number;
  in_flight_kobo: number;
}
export interface Invoice {
  id: string;
  doctor_user_id: string;
  doctor_name: string;
  ref: string | null;
  appointment_id: string | null;
  gross_kobo: number;
  commission_kobo: number;
  vat_kobo: number;
  net_kobo: number;
  currency: string;
  status: string;
  issued_at: string;
}
export interface CommissionOverride {
  doctor_user_id: string;
  doctor_name: string;
  commission_bps: number;
  vat_bps: number;
  payout_cycle: string;
  updated_at: string;
}
export interface CommissionConfigView {
  platform_commission_bps: number;
  doctor_share_bps: number;
  overrides: CommissionOverride[];
}
export interface Paged<T> { items: T[]; total: number }

export interface FinanceWindow { from?: string; to?: string }
export interface PageArgs { limit?: number; offset?: number }

export const getFinanceSummary = (w: FinanceWindow = {}) => getJson<FinanceSummary>('/summary', { ...w });

export const listPayouts = (f: FinanceWindow & PageArgs & { status?: string; doctor_user_id?: string } = {}) =>
  getJson<Paged<Payout>>('/payouts', { ...f });

export const getPayout = (id: string) => getJson<PayoutDetail>(`/payouts/${encodeURIComponent(id)}`);

export const listEarnings = (f: FinanceWindow & PageArgs & { doctor_user_id?: string } = {}) =>
  getJson<Paged<DoctorEarnings>>('/earnings', { ...f });

export const listInvoices = (f: FinanceWindow & PageArgs & { doctor_user_id?: string; status?: string } = {}) =>
  getJson<Paged<Invoice>>('/invoices', { ...f });

export const listDisputes = (f: PageArgs & { status?: string } = {}) => getJson<Paged<Dispute>>('/disputes', { ...f });

export const getDispute = (id: string) => getJson<DisputeDetail>(`/disputes/${encodeURIComponent(id)}`);

export const getCommissionConfig = () => getJson<CommissionConfigView>('/commission-config');

/** Basis points as a percentage string, e.g. 1500 -> "15%", 750 -> "7.5%". */
export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2).replace(/\.?0+$/, '')}%`;
}
