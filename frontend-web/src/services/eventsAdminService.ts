// ── Admin — Paymax Events (Ticketing + Cashless event wallet) control-plane ────
// Mock by default (mirrors stays / savings admin services). Flip with
// NEXT_PUBLIC_EVENTS_USE_MOCK=false to hit the live Go backend at /api/events/admin/*.
// RBAC: events.admin.* gates wired on the sidebar.
// Money is BIGINT kobo (minor units) throughout. Surfaces NL-3 (closed-loop +
// residual refund), NL-10 (KYC payout gate), NL-12 (immutable audit).

import { env } from '@/config/env';
import type {
  EventsDashboard,
  EventApprovalItem,
  EventDecisionResult,
  EventApprovalDecision,
  EventSummary,
  EventDetail,
  TicketTier,
  CashlessFloat,
  VendorRecord,
  VendorPayoutResult,
  Settlement,
  SettlementResolveResult,
  EventFraudSignal,
  EventFraudAction,
  EventFraudActionResult,
} from '@/types/eventsAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_EVENTS_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/events/admin');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 240) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function sendJson<T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { method, headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

// ── Display helper: kobo → ₦ ─────────────────────────────────────────────────
export function formatNaira(kobo: number): string {
  const naira = (kobo ?? 0) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const dateAhead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

// ════════════════════════════════════════════════════════════════════════════
// A · Dashboard
// ════════════════════════════════════════════════════════════════════════════
const DASHBOARD: EventsDashboard = {
  gmv_today_kobo: 184_500_000_00,
  gmv_30d_kobo: 3_942_800_000_00,
  tickets_sold_today: 6_120,
  tickets_sold_30d: 142_880,
  take_rate: 0.072,
  net_revenue_30d_kobo: 283_881_000_0,
  avg_ticket_price_kobo: 27_600_00,
  cashless_float_kobo: 612_400_000_00,
  cashless_liability_kobo: 88_200_000_00,
  residual_refund_pending_kobo: 14_700_000_00,
  vendor_float_kobo: 196_500_000_00,
  events_live: 42,
  events_pending_approval: 17,
  vendors_active: 318,
  vendor_payouts_kyc_hold: 9,
  settlement_breaks_open: 3,
  settlement_break_value_kobo: 2_410_000_00,
  fraud_open: 6,
  ticket_mix: [
    { tier: 'Regular', sold: 96_400, gmv_kobo: 1_446_000_000_00, share_pct: 0.367 },
    { tier: 'VIP', sold: 34_200, gmv_kobo: 1_710_000_000_00, share_pct: 0.434 },
    { tier: 'VVIP / Table', sold: 12_280, gmv_kobo: 786_800_000_00, share_pct: 0.199 },
  ],
  gmv_trend: Array.from({ length: 14 }).map((_, i) => {
    const gmv = (110_000_000 + i * 5_400_000 + Math.round(Math.sin(i / 2) * 9_000_000)) * 100;
    return { date: dateStr(13 - i), gmv_kobo: gmv, net_kobo: Math.round(gmv * 0.072) };
  }),
  activity: [
    { id: 'ev1', kind: 'event_approved', label: 'Event approved & moved to LIVE — "Detty December Fest 2026"', ref: 'evt_8841', created_at: iso(0.3) },
    { id: 'ev2', kind: 'residual_refund', label: 'Residual refund batch released to funding wallets at event close (NL-3)', ref: 'evt_8702', created_at: iso(1.1) },
    { id: 'ev3', kind: 'vendor_payout', label: 'Vendor payout held — KYC tier insufficient (NL-10)', ref: 'ven_5521', created_at: iso(2.2) },
    { id: 'ev4', kind: 'settlement_break', label: 'Settlement reconciliation break flagged on cashless batch', ref: 'set_3310', created_at: iso(3.4) },
    { id: 'ev5', kind: 'cashless_topup', label: 'Abnormal top-up pattern flagged for review — single wallet, rapid loads', ref: 'fr_2207', created_at: iso(5) },
    { id: 'ev6', kind: 'ticket_sale', label: 'VIP tier sold out — "Lagos Tech Summit"', ref: 'evt_8650', created_at: iso(7) },
  ],
};
export async function getEventsDashboard(): Promise<EventsDashboard> {
  if (USE_MOCK) { await delay(); return { ...DASHBOARD, ticket_mix: [...DASHBOARD.ticket_mix], gmv_trend: [...DASHBOARD.gmv_trend], activity: [...DASHBOARD.activity] }; }
  return getJson<EventsDashboard>('/dashboard');
}

// ════════════════════════════════════════════════════════════════════════════
// B · Event approval / CMS queue
// ════════════════════════════════════════════════════════════════════════════
const APPROVALS: EventApprovalItem[] = [
  { id: 'evt_9001', title: 'Afrobeats Live Lagos', organiser_masked: 'Kemi Sound•••', category: 'Concert', city: 'Lagos', status: 'submitted', starts_at: dateAhead(21), capacity: 8000, tiers_count: 3, cashless_enabled: true, submitted_at: iso(6), cms_complete: true, flagged_terms: false, created_at: iso(48) },
  { id: 'evt_9002', title: 'Abuja Food Festival', organiser_masked: 'Naija Eats•••', category: 'Festival', city: 'Abuja', status: 'submitted', starts_at: dateAhead(35), capacity: 5000, tiers_count: 2, cashless_enabled: true, submitted_at: iso(20), cms_complete: false, flagged_terms: false, created_at: iso(72) },
  { id: 'evt_9003', title: 'Crypto Mega Giveaway Party', organiser_masked: 'Quick Cash•••', category: 'Other', city: 'Lagos', status: 'submitted', starts_at: dateAhead(10), capacity: 2000, tiers_count: 1, cashless_enabled: true, submitted_at: iso(3), cms_complete: true, flagged_terms: true, created_at: iso(12) },
  { id: 'evt_9004', title: 'Port Harcourt Comedy Night', organiser_masked: 'PH Laughs•••', category: 'Comedy', city: 'Port Harcourt', status: 'draft', starts_at: dateAhead(45), capacity: 1200, tiers_count: 2, cashless_enabled: false, submitted_at: null, cms_complete: false, flagged_terms: false, created_at: iso(30) },
  { id: 'evt_9005', title: 'Owambe Owners Convention', organiser_masked: 'Lekki Events•••', category: 'Conference', city: 'Lagos', status: 'submitted', starts_at: dateAhead(60), capacity: 3000, tiers_count: 4, cashless_enabled: true, submitted_at: iso(40), cms_complete: true, flagged_terms: false, created_at: iso(120) },
];
export async function listEventApprovals(opts?: { status?: string; q?: string }): Promise<EventApprovalItem[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...APPROVALS];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.title.toLowerCase().includes(q) || r.organiser_masked.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<EventApprovalItem[]>(`/approvals${qs.toString() ? `?${qs}` : ''}`);
}
export async function decideEvent(id: string, decision: EventApprovalDecision, note?: string): Promise<EventDecisionResult> {
  if (USE_MOCK) {
    await delay();
    const status =
      decision === 'approve' ? 'approved'
      : decision === 'reject' ? 'draft'
      : decision === 'suspend' ? 'suspended'
      : 'submitted';
    return { id, status, audit_id: `aud_${Math.random().toString(36).slice(2, 10)}`, message: `Event ${id}: ${decision} applied. State machine DRAFT→SUBMITTED→APPROVED enforced. Recorded to immutable audit (NL-12).` };
  }
  return sendJson<EventDecisionResult>('POST', `/approvals/${id}/decide`, { decision, note });
}

// ════════════════════════════════════════════════════════════════════════════
// C · Event catalog + detail
// ════════════════════════════════════════════════════════════════════════════
const EVENTS: EventSummary[] = [
  { id: 'evt_8841', title: 'Detty December Fest 2026', organiser_masked: 'Kemi Sound•••', category: 'Concert', city: 'Lagos', status: 'live', starts_at: dateAhead(40), capacity: 12000, tickets_sold: 9420, gmv_kobo: 2_120_000_000_00, cashless_enabled: true, created_at: dateStr(60) },
  { id: 'evt_8702', title: 'Lagos Tech Summit', organiser_masked: 'TechCity•••', category: 'Conference', city: 'Lagos', status: 'closed', starts_at: dateStr(8), capacity: 4000, tickets_sold: 3880, gmv_kobo: 612_400_000_00, cashless_enabled: true, created_at: dateStr(120) },
  { id: 'evt_8650', title: 'Calabar Carnival Afterparty', organiser_masked: 'Cross River•••', category: 'Festival', city: 'Calabar', status: 'approved', starts_at: dateAhead(75), capacity: 6000, tickets_sold: 1240, gmv_kobo: 186_000_000_00, cashless_enabled: true, created_at: dateStr(30) },
  { id: 'evt_8540', title: 'Abuja Jazz Night', organiser_masked: 'Capital Sounds•••', category: 'Concert', city: 'Abuja', status: 'suspended', starts_at: dateAhead(20), capacity: 1500, tickets_sold: 320, gmv_kobo: 24_000_000_00, cashless_enabled: false, created_at: dateStr(45) },
];
export async function listEvents(opts?: { status?: string; q?: string }): Promise<EventSummary[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...EVENTS];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.title.toLowerCase().includes(q) || r.organiser_masked.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<EventSummary[]>(`/events${qs.toString() ? `?${qs}` : ''}`);
}

export async function getEvent(id: string): Promise<EventDetail> {
  if (USE_MOCK) {
    await delay();
    const base = EVENTS.find((e) => e.id === id) ?? EVENTS[0];
    return {
      ...base,
      id,
      description: 'The biggest end-of-year experience — live performances, food courts, and full cashless tap-to-pay vending across all zones.',
      venue: 'Eko Atlantic City, Lagos',
      capacity_sold_pct: base.capacity ? base.tickets_sold / base.capacity : 0,
      net_revenue_kobo: Math.round(base.gmv_kobo * 0.072),
      cashless_float_kobo: 312_400_000_00,
      cashless_liability_kobo: 41_800_000_00,
      tiers: [
        { id: 'tk_1', event_id: id, event_title: base.title, name: 'Regular', price_kobo: 15_000_00, quantity: 8000, sold: 6420, held: 120, status: 'on_sale', config_version: 2, promo_codes: [{ code: 'EARLYBIRD', discount_pct: 0.15, max_redemptions: 1000, redeemed: 640, active: true }] },
        { id: 'tk_2', event_id: id, event_title: base.title, name: 'VIP', price_kobo: 50_000_00, quantity: 3000, sold: 2480, held: 60, status: 'on_sale', config_version: 1, promo_codes: [] },
        { id: 'tk_3', event_id: id, event_title: base.title, name: 'VVIP Table', price_kobo: 250_000_00, quantity: 1000, sold: 520, held: 10, status: 'on_sale', config_version: 1, promo_codes: [] },
      ],
      timeline: [
        { id: 't1', status: 'draft', label: 'Event created as DRAFT', actor_masked: 'Kemi Sound•••', audit_id: 'aud_aaa1', at: iso(720) },
        { id: 't2', status: 'submitted', label: 'Submitted for approval with full CMS', actor_masked: 'Kemi Sound•••', audit_id: 'aud_aaa2', at: iso(540) },
        { id: 't3', status: 'approved', label: 'Approved by ops — content & policy cleared', actor_masked: 'admin:fola•••', audit_id: 'aud_aaa3', at: iso(360) },
        { id: 't4', status: 'live', label: 'Moved to LIVE — tickets & cashless enabled', actor_masked: 'admin:fola•••', audit_id: 'aud_aaa4', at: iso(120) },
      ],
    };
  }
  return getJson<EventDetail>(`/events/${id}`);
}

// ════════════════════════════════════════════════════════════════════════════
// D · Ticket inventory / tiers / promo
// ════════════════════════════════════════════════════════════════════════════
const TICKETS: TicketTier[] = [
  { id: 'tk_101', event_id: 'evt_8841', event_title: 'Detty December Fest 2026', name: 'Regular', price_kobo: 15_000_00, quantity: 8000, sold: 6420, held: 120, status: 'on_sale', config_version: 2, promo_codes: [{ code: 'EARLYBIRD', discount_pct: 0.15, max_redemptions: 1000, redeemed: 640, active: true }, { code: 'STUDENT', discount_pct: 0.20, max_redemptions: 500, redeemed: 500, active: false }] },
  { id: 'tk_102', event_id: 'evt_8841', event_title: 'Detty December Fest 2026', name: 'VIP', price_kobo: 50_000_00, quantity: 3000, sold: 3000, held: 0, status: 'sold_out', config_version: 1, promo_codes: [] },
  { id: 'tk_103', event_id: 'evt_8650', event_title: 'Calabar Carnival Afterparty', name: 'Early Access', price_kobo: 10_000_00, quantity: 2000, sold: 0, held: 0, status: 'scheduled', config_version: 1, promo_codes: [{ code: 'CARNIVAL10', discount_pct: 0.10, max_redemptions: 2000, redeemed: 0, active: true }] },
  { id: 'tk_104', event_id: 'evt_8702', event_title: 'Lagos Tech Summit', name: 'Standard', price_kobo: 25_000_00, quantity: 4000, sold: 3880, held: 0, status: 'ended', config_version: 3, promo_codes: [] },
];
export async function listTickets(opts?: { status?: string; event_id?: string; q?: string }): Promise<TicketTier[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...TICKETS];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.event_id) rows = rows.filter((r) => r.event_id === opts.event_id);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.event_title.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.event_id) qs.set('event_id', opts.event_id);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<TicketTier[]>(`/tickets${qs.toString() ? `?${qs}` : ''}`);
}

// ════════════════════════════════════════════════════════════════════════════
// E · Cashless float & liability + residual refunds (NL-3)
// ════════════════════════════════════════════════════════════════════════════
const CASHLESS: CashlessFloat = {
  generated_at: iso(0.2),
  total_loaded_kobo: 700_600_000_00,
  total_spent_kobo: 612_400_000_00,
  total_liability_kobo: 88_200_000_00,
  total_residual_pending_kobo: 14_700_000_00,
  ledger_balance_kobo: 88_200_000_00,
  custody_balance_kobo: 88_212_400_00,
  delta_kobo: 12_400_00,
  lines: [
    { event_id: 'evt_8841', event_title: 'Detty December Fest 2026', wallet_status: 'spending', loaded_kobo: 354_200_000_00, spent_kobo: 312_400_000_00, liability_kobo: 41_800_000_00, residual_refunded_kobo: 0, residual_pending_kobo: 0, closed_at: null },
    { event_id: 'evt_8702', event_title: 'Lagos Tech Summit', wallet_status: 'closed', loaded_kobo: 196_400_000_00, spent_kobo: 181_700_000_00, liability_kobo: 14_700_000_00, residual_refunded_kobo: 0, residual_pending_kobo: 14_700_000_00, closed_at: iso(8 * 24) },
    { event_id: 'evt_8650', event_title: 'Calabar Carnival Afterparty', wallet_status: 'open', loaded_kobo: 150_000_000_00, spent_kobo: 118_300_000_00, liability_kobo: 31_700_000_00, residual_refunded_kobo: 0, residual_pending_kobo: 0, closed_at: null },
  ],
};
export async function getCashlessFloat(): Promise<CashlessFloat> {
  if (USE_MOCK) { await delay(); return { ...CASHLESS, lines: [...CASHLESS.lines] }; }
  return getJson<CashlessFloat>('/cashless');
}

// ════════════════════════════════════════════════════════════════════════════
// F · Vendors + KYC payout gate (NL-10)
// ════════════════════════════════════════════════════════════════════════════
const VENDORS: VendorRecord[] = [
  { id: 'ven_5501', name_masked: 'Mama Put•••', event_id: 'evt_8841', event_title: 'Detty December Fest 2026', kyc_tier: 'tier2', kyc_verified: true, collected_kobo: 18_400_000_00, fees_kobo: 920_000_00, net_payable_kobo: 17_480_000_00, payout_status: 'approved', active: true, created_at: dateStr(20) },
  { id: 'ven_5521', name_masked: 'Suya King•••', event_id: 'evt_8841', event_title: 'Detty December Fest 2026', kyc_tier: 'tier0', kyc_verified: false, collected_kobo: 9_200_000_00, fees_kobo: 460_000_00, net_payable_kobo: 8_740_000_00, payout_status: 'kyc_hold', active: true, created_at: dateStr(18) },
  { id: 'ven_5540', name_masked: 'Cocktail Bar•••', event_id: 'evt_8702', event_title: 'Lagos Tech Summit', kyc_tier: 'tier3', kyc_verified: true, collected_kobo: 24_600_000_00, fees_kobo: 1_230_000_00, net_payable_kobo: 23_370_000_00, payout_status: 'paid', active: false, created_at: dateStr(120) },
  { id: 'ven_5560', name_masked: 'Small Chops•••', event_id: 'evt_8650', event_title: 'Calabar Carnival Afterparty', kyc_tier: 'tier1', kyc_verified: true, collected_kobo: 4_100_000_00, fees_kobo: 205_000_00, net_payable_kobo: 3_895_000_00, payout_status: 'pending', active: true, created_at: dateStr(10) },
];
export async function listVendors(opts?: { payout_status?: string; q?: string }): Promise<VendorRecord[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...VENDORS];
    if (opts?.payout_status) rows = rows.filter((r) => r.payout_status === opts.payout_status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.name_masked.toLowerCase().includes(q) || r.event_title.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.payout_status) qs.set('payout_status', opts.payout_status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<VendorRecord[]>(`/vendors${qs.toString() ? `?${qs}` : ''}`);
}
export async function decideVendorPayout(id: string, decision: 'approve' | 'reject', note?: string): Promise<VendorPayoutResult> {
  if (USE_MOCK) {
    await delay();
    const v = VENDORS.find((x) => x.id === id);
    if (decision === 'approve' && v && !v.kyc_verified) {
      return { id, payout_status: 'kyc_hold', audit_id: `aud_${Math.random().toString(36).slice(2, 10)}`, message: `Payout blocked — vendor ${id} KYC tier insufficient (NL-10). Payout stays fail-closed until KYC clears. Recorded to immutable audit.` };
    }
    return { id, payout_status: decision === 'approve' ? 'approved' : 'rejected', audit_id: `aud_${Math.random().toString(36).slice(2, 10)}`, message: `Vendor ${id} payout ${decision === 'approve' ? 'approved' : 'rejected'}. KYC gate (NL-10) passed. Recorded to immutable audit (NL-12).` };
  }
  return sendJson<VendorPayoutResult>('POST', `/vendors/${id}/payout`, { decision, note });
}

// ════════════════════════════════════════════════════════════════════════════
// G · Settlement + reconciliation
// ════════════════════════════════════════════════════════════════════════════
const SETTLEMENT: Settlement = {
  generated_at: iso(0.2),
  total_gross_kobo: 2_918_800_000_00,
  total_fees_kobo: 210_153_000_0,
  total_organiser_net_kobo: 2_660_000_000_00,
  total_vendor_payouts_kobo: 196_500_000_00,
  total_break_kobo: 2_410_000_00,
  breaks_open: 3,
  lines: [
    { id: 'set_3301', event_id: 'evt_8702', event_title: 'Lagos Tech Summit', gross_kobo: 794_100_000_00, fees_kobo: 57_175_000_0, vendor_payouts_kobo: 47_970_000_00, organiser_net_kobo: 688_355_000_0, residual_refunds_kobo: 14_700_000_00, status: 'investigating', break_kobo: 1_240_000_00, settled_at: null },
    { id: 'set_3310', event_id: 'evt_8841', event_title: 'Detty December Fest 2026', gross_kobo: 1_240_000_000_00, fees_kobo: 89_280_000_0, vendor_payouts_kobo: 26_220_000_00, organiser_net_kobo: 1_124_500_000_00, residual_refunds_kobo: 0, status: 'open', break_kobo: 1_170_000_00, settled_at: null },
    { id: 'set_3288', event_id: 'evt_8540', event_title: 'Abuja Jazz Night', gross_kobo: 24_000_000_00, fees_kobo: 1_728_000_00, vendor_payouts_kobo: 0, organiser_net_kobo: 22_272_000_00, residual_refunds_kobo: 0, status: 'settled', break_kobo: 0, settled_at: iso(48) },
  ],
};
export async function getSettlement(): Promise<Settlement> {
  if (USE_MOCK) { await delay(); return { ...SETTLEMENT, lines: [...SETTLEMENT.lines] }; }
  return getJson<Settlement>('/settlement');
}
export async function resolveSettlementBreak(id: string, action: 'investigate' | 'resolve' | 'reconcile', note?: string): Promise<SettlementResolveResult> {
  if (USE_MOCK) {
    await delay();
    const status = action === 'investigate' ? 'investigating' : action === 'resolve' ? 'resolved' : 'reconciled';
    return { id, status, audit_id: `aud_${Math.random().toString(36).slice(2, 10)}`, message: `Settlement break ${id}: ${action} applied. Ledger projection reconciled (NL-8). Recorded to immutable audit (NL-12).` };
  }
  return sendJson<SettlementResolveResult>('POST', `/settlement/${id}/resolve`, { action, note });
}

// ════════════════════════════════════════════════════════════════════════════
// H · Fraud — dup-scan / abnormal top-up
// ════════════════════════════════════════════════════════════════════════════
const FRAUD: EventFraudSignal[] = [
  { id: 'fr_2207', event_id: 'evt_8841', event_title: 'Detty December Fest 2026', kind: 'abnormal_topup', subject_masked: 'wlt Chioma•••', detail: '11 rapid top-ups (₦2.4m total) in 6 minutes from one device', severity: 'high', amount_kobo: 2_400_000_00, status: 'open', created_at: iso(2) },
  { id: 'fr_2188', event_id: 'evt_8841', event_title: 'Detty December Fest 2026', kind: 'dup_scan', subject_masked: 'tkt #A4821•••', detail: 'Single ticket scanned at 3 gates within 90 seconds', severity: 'medium', amount_kobo: 15_000_00, status: 'investigating', created_at: iso(5) },
  { id: 'fr_2150', event_id: 'evt_8702', event_title: 'Lagos Tech Summit', kind: 'vendor_self_charge', subject_masked: 'ven Suya King•••', detail: 'Vendor charging own wallet — possible cash-out laundering', severity: 'critical', amount_kobo: 880_000_00, status: 'open', created_at: iso(9) },
  { id: 'fr_2101', event_id: 'evt_8650', event_title: 'Calabar Carnival Afterparty', kind: 'rapid_refund', subject_masked: 'wlt Emeka•••', detail: 'Load then immediate residual-refund request, repeated 4×', severity: 'low', amount_kobo: 120_000_00, status: 'cleared', created_at: iso(30) },
];
export async function listEventFraud(opts?: { status?: string; kind?: string; q?: string }): Promise<EventFraudSignal[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...FRAUD];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.kind) rows = rows.filter((r) => r.kind === opts.kind);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.subject_masked.toLowerCase().includes(q) || r.event_title.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.kind) qs.set('kind', opts.kind);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<EventFraudSignal[]>(`/fraud${qs.toString() ? `?${qs}` : ''}`);
}
export async function decideEventFraud(id: string, action: EventFraudAction, note?: string): Promise<EventFraudActionResult> {
  if (USE_MOCK) {
    await delay();
    const status = action === 'investigate' ? 'investigating' : action === 'clear' ? 'cleared' : 'blocked';
    return { id, status, audit_id: `aud_${Math.random().toString(36).slice(2, 10)}`, message: `Fraud signal ${id}: ${action} applied. Recorded to immutable audit (NL-12).` };
  }
  return sendJson<EventFraudActionResult>('POST', `/fraud/${id}/action`, { action, note });
}
