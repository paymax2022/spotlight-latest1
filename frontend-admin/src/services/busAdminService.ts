// Admin bus ticket search + manual refund queue (/api/finance/admin/transport/bus/*).
// Money is integer kobo. resolve-refund is a money mutation: it carries an
// operation-derived Idempotency-Key so a double-click dedupes server-side.

import { apiRoot } from '@/config/env';
import { operationKey } from './idempotency';

export type BusRefundStatus = 'none' | 'pending' | 'refunded' | 'failed' | 'manual_required';
export type ManualRefundMethod = 'wallet_refund' | 'offline';

export interface AdminBusTicket {
  id: string;
  userId: string;
  scheduleId: string;
  seatNumber: number;
  passengerName: string;
  passengerPhone: string | null;
  status: string;
  boardingStatus: string;
  paymentStatus: string;
  refundStatus: BusRefundStatus;
  settleMode: string;
  payoutState: string;
  fareKobo: number;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  departureTime: string;
  routeLabel: string;
  operatorName: string;
  settleUserId: string | null;
  settlementStatus: string | null;
  providerKobo: number | null;
  feeKobo: number | null;
  manualRefundMethod: ManualRefundMethod | null;
  manualRefundReference: string | null;
  manualRefundResolvedAt: string | null;
}

export interface AdminBusTicketPage {
  tickets: AdminBusTicket[];
  total: number;
  limit: number;
  offset: number;
}

export interface BusTicketSearch {
  q?: string;
  status?: string;
  refundStatus?: BusRefundStatus | '';
  scheduleId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface ManualRefundResult {
  ok: boolean;
  ticketId: string;
  refundStatus: BusRefundStatus;
  method: ManualRefundMethod | null;
  reference: string | null;
  resolvedAt: string | null;
  refundedKobo: number;
  replayed: boolean;
}

const base = () => `${apiRoot()}/api/finance/admin/transport/bus`;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = body?.code ? ` [${body.code}]` : '';
    throw new Error(`${body?.error || body?.message || `Request failed (${res.status})`}${code}`);
  }
  return body as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function searchBusTickets(f: BusTicketSearch): Promise<AdminBusTicketPage> {
  return request(`${base()}/tickets${qs({
    q: f.q?.trim(), status: f.status, refund_status: f.refundStatus, schedule_id: f.scheduleId,
    from: f.from, to: f.to, limit: f.limit, offset: f.offset,
  })}`);
}

export function getManualRefundQueue(stuckMinutes: number, limit: number, offset: number): Promise<AdminBusTicketPage> {
  return request(`${base()}/refunds/manual${qs({ stuck_minutes: stuckMinutes, limit, offset })}`);
}

export function resolveManualRefund(
  ticketId: string, method: ManualRefundMethod, reason: string, reference?: string,
): Promise<ManualRefundResult> {
  return request(`${base()}/tickets/${encodeURIComponent(ticketId)}/resolve-refund`, {
    method: 'POST',
    headers: { 'Idempotency-Key': operationKey('bus:resolve-refund', ticketId, method) },
    body: JSON.stringify({ method, reason, reference: reference ?? '' }),
  });
}
