// ── Admin — Paymax Mobility Business Logistics service ───────────────────────
// Business accounts · deliveries · invoices. Mock by default; flip USE_MOCK to
// false and the fetch branches hit /api/finance/admin/transport/business/*.
// This route IS live — registered under FeatureTransportModesEnabled, same as
// the sibling mobilityModesAdminService.ts — the OLD "Go backend admin
// endpoints not live yet" claim here was stale.
// All money is integer minor units (kobo). Every mutation is server-audited.

import { env } from '@/config/env';
import type {
  BusinessAccountRow, BusinessAccountStatus,
  BusinessDeliveryRow, DeliveryStatus,
  BusinessInvoiceRow,
  ModeStatusPatch,
} from '@/types/mobilityModes';

// Mock by default; flip with NEXT_PUBLIC_MOBILITY_MODES_USE_MOCK=false once the
// admin control-plane endpoints are live on the Go backend.
const USE_MOCK = (process.env.NEXT_PUBLIC_MOBILITY_MODES_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  // env.apiBaseUrl defaults to .../api/v1 ; admin transport lives under /api/finance/admin/transport
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/finance/admin/transport');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// Every write below has a real, verified live endpoint (backend/internal/
// transport/admin_logistics_event.go, same FeatureTransportModesEnabled block
// as mobilityModesAdminService.ts) — fixture mode refuses loudly instead of
// reporting a write it did not perform, and the live branches now actually
// check the response instead of discarding it (the same "reports success on a
// failed fetch" bug mobilityModesAdminService.ts had). issueBusinessInvoice
// and markBusinessInvoicePaid were also calling PATCH where the backend only
// registers POST — fixed. See docs/audit/ADMIN_SIMULATED_WRITES.md.
const NOT_IN_FIXTURE_MODE =
  'is unavailable in fixture mode: this console will not report a write it did not perform. ' +
  'Set NEXT_PUBLIC_MOBILITY_MODES_USE_MOCK=false to make this change against the live backend.';
async function writeOk(url: string, init: RequestInit): Promise<{ ok: boolean }> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || body?.message || `Request failed (${res.status})`);
  }
  return { ok: true };
}

// ─── Mock datasets ────────────────────────────────────────────────────────────

const ACCOUNTS: BusinessAccountRow[] = [
  { id: 'biz_7001', name: 'Jumia Express Lagos', ownerName: 'Chidozie E.', accountType: 'enterprise', billingMode: 'invoice', codEnabled: true, status: 'active', walletBalanceKobo: 0, monthlyVolume: 1840, createdAt: '2026-01-12T09:00:00Z', updatedAt: '2026-06-20T10:00:00Z' },
  { id: 'biz_7002', name: 'Konga Pharmacy', ownerName: 'Amaka N.', accountType: 'sme', billingMode: 'prepaid', codEnabled: false, status: 'active', walletBalanceKobo: 4_250_000_00, monthlyVolume: 420, createdAt: '2026-02-03T09:00:00Z', updatedAt: '2026-06-20T11:30:00Z' },
  { id: 'biz_7003', name: 'FreshFarms Produce', ownerName: 'Tunde B.', accountType: 'sme', billingMode: 'prepaid', codEnabled: true, status: 'suspended', walletBalanceKobo: 320_000_00, monthlyVolume: 95, createdAt: '2026-03-15T09:00:00Z', updatedAt: '2026-06-19T16:00:00Z' },
  { id: 'biz_7004', name: 'TechHub Devices', ownerName: 'Ngozi A.', accountType: 'enterprise', billingMode: 'invoice', codEnabled: false, status: 'active', walletBalanceKobo: 0, monthlyVolume: 760, createdAt: '2026-04-01T09:00:00Z', updatedAt: '2026-06-18T09:00:00Z' },
  { id: 'biz_6990', name: 'Lagos Linen Co', ownerName: 'Bola I.', accountType: 'micro', billingMode: 'prepaid', codEnabled: true, status: 'closed', walletBalanceKobo: 0, monthlyVolume: 0, createdAt: '2025-11-20T09:00:00Z', updatedAt: '2026-05-30T12:00:00Z' },
];

const DELIVERIES: BusinessDeliveryRow[] = [
  { id: 'bdl_8001', accountName: 'Jumia Express Lagos', accountId: 'biz_7001', status: 'assigned', size: 'medium', pickupAddress: 'Jumia Warehouse, Ikeja', dropoffAddress: 'Lekki Phase 1', receiverName: 'Sola M.', courierName: 'Tunde Adeyemi', fareKobo: 1_500_00, codKobo: 24_000_00, escrowStatus: 'none', podProofUrl: null, failureReason: null, batchId: 'bat_900', zone: 'Lagos Island', createdAt: '2026-06-20T08:00:00Z', updatedAt: '2026-06-20T09:00:00Z' },
  { id: 'bdl_8002', accountName: 'Konga Pharmacy', accountId: 'biz_7002', status: 'picked_up', size: 'small', pickupAddress: 'Konga Hub, Yaba', dropoffAddress: 'Surulere', receiverName: 'Kemi T.', courierName: 'Grace E.', fareKobo: 1_200_00, codKobo: 0, escrowStatus: 'held', podProofUrl: null, failureReason: null, batchId: null, zone: 'Yaba', createdAt: '2026-06-20T09:30:00Z', updatedAt: '2026-06-20T10:15:00Z' },
  { id: 'bdl_8003', accountName: 'Jumia Express Lagos', accountId: 'biz_7001', status: 'delivered', size: 'large', pickupAddress: 'Jumia Warehouse, Ikeja', dropoffAddress: 'Ajah', receiverName: 'David N.', courierName: 'Ibrahim S.', fareKobo: 3_100_00, codKobo: 56_000_00, escrowStatus: 'none', podProofUrl: '#', failureReason: null, batchId: 'bat_900', zone: 'Lekki', createdAt: '2026-06-19T08:00:00Z', updatedAt: '2026-06-19T12:00:00Z' },
  { id: 'bdl_8004', accountName: 'FreshFarms Produce', accountId: 'biz_7003', status: 'failed', size: 'medium', pickupAddress: 'Mile 12 Market', dropoffAddress: 'Magodo', receiverName: 'Ada U.', courierName: 'Femi K.', fareKobo: 1_800_00, codKobo: 12_000_00, escrowStatus: 'refunded', podProofUrl: null, failureReason: 'Receiver unavailable after 3 attempts', batchId: null, zone: 'Ketu', createdAt: '2026-06-19T10:00:00Z', updatedAt: '2026-06-19T15:00:00Z' },
  { id: 'bdl_8005', accountName: 'Konga Pharmacy', accountId: 'biz_7002', status: 'created', size: 'small', pickupAddress: 'Konga Hub, Yaba', dropoffAddress: 'Gbagada', receiverName: 'Chika O.', courierName: null, fareKobo: 1_000_00, codKobo: 0, escrowStatus: 'held', podProofUrl: null, failureReason: null, batchId: null, zone: 'Yaba', createdAt: '2026-06-20T11:00:00Z', updatedAt: '2026-06-20T11:00:00Z' },
];

const INVOICES: BusinessInvoiceRow[] = [
  { id: 'inv_9001', accountName: 'Jumia Express Lagos', accountId: 'biz_7001', periodLabel: 'May 2026', status: 'paid', deliveryCount: 1840, amountKobo: 4_140_000_00, issuedAt: '2026-06-01T09:00:00Z', dueAt: '2026-06-15T00:00:00Z', paidAt: '2026-06-10T14:00:00Z' },
  { id: 'inv_9002', accountName: 'Jumia Express Lagos', accountId: 'biz_7001', periodLabel: 'Jun 2026', status: 'open', deliveryCount: 612, amountKobo: 1_377_000_00, issuedAt: null, dueAt: null, paidAt: null },
  { id: 'inv_9003', accountName: 'TechHub Devices', accountId: 'biz_7004', periodLabel: 'May 2026', status: 'issued', deliveryCount: 760, amountKobo: 2_356_000_00, issuedAt: '2026-06-01T09:00:00Z', dueAt: '2026-06-15T00:00:00Z', paidAt: null },
  { id: 'inv_9004', accountName: 'TechHub Devices', accountId: 'biz_7004', periodLabel: 'Apr 2026', status: 'overdue', deliveryCount: 540, amountKobo: 1_674_000_00, issuedAt: '2026-05-01T09:00:00Z', dueAt: '2026-05-15T00:00:00Z', paidAt: null },
];

// ─── Accounts ─────────────────────────────────────────────────────────────────
export async function getBusinessAccounts(status?: BusinessAccountStatus | ''): Promise<BusinessAccountRow[]> {
  if (USE_MOCK) {
    await delay();
    let list = [...ACCOUNTS];
    if (status) list = list.filter((a) => a.status === status);
    return list;
  }
  const q = status ? `?status=${status}` : '';
  const res = await fetch(`${adminBase()}/business/accounts${q}`, { headers: authHeaders() });
  return res.json();
}

export async function setBusinessAccountStatus(id: string, patch: ModeStatusPatch): Promise<{ ok: boolean }> {
  if (USE_MOCK) throw new Error(`Setting a business account status ${NOT_IN_FIXTURE_MODE}`);
  return writeOk(`${adminBase()}/business/accounts/${id}/status`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(patch) });
}

// ─── Deliveries ───────────────────────────────────────────────────────────────
export async function getBusinessDeliveries(status?: DeliveryStatus | ''): Promise<BusinessDeliveryRow[]> {
  if (USE_MOCK) {
    await delay();
    let list = [...DELIVERIES];
    if (status) list = list.filter((d) => d.status === status);
    return list;
  }
  const q = status ? `?status=${status}` : '';
  const res = await fetch(`${adminBase()}/business/deliveries${q}`, { headers: authHeaders() });
  return res.json();
}

export async function setBusinessDeliveryStatus(id: string, patch: ModeStatusPatch): Promise<{ ok: boolean }> {
  if (USE_MOCK) throw new Error(`Setting a business delivery status ${NOT_IN_FIXTURE_MODE}`);
  return writeOk(`${adminBase()}/business/deliveries/${id}/status`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(patch) });
}

// ─── Invoices ─────────────────────────────────────────────────────────────────
export async function getBusinessInvoices(status?: BusinessInvoiceRow['status'] | ''): Promise<BusinessInvoiceRow[]> {
  if (USE_MOCK) {
    await delay();
    let list = [...INVOICES];
    if (status) list = list.filter((i) => i.status === status);
    return list;
  }
  const q = status ? `?status=${status}` : '';
  const res = await fetch(`${adminBase()}/business/invoices${q}`, { headers: authHeaders() });
  return res.json();
}

export async function issueBusinessInvoice(id: string, reason: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) throw new Error(`Issuing a business invoice ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /business/invoices/:id/issue (AdminBusinessInvoiceIssue) — the
  // OLD method here was PATCH; the registered route is POST.
  return writeOk(`${adminBase()}/business/invoices/${id}/issue`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ reason }) });
}

export async function markBusinessInvoicePaid(id: string, reason: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) throw new Error(`Marking a business invoice paid ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /business/invoices/:id/mark-paid (AdminBusinessInvoiceMarkPaid) —
  // the OLD method here was PATCH; the registered route is POST.
  return writeOk(`${adminBase()}/business/invoices/${id}/mark-paid`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ reason }) });
}
