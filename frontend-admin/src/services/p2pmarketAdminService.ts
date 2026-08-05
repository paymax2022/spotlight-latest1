// ── Admin — P2P Marketplace ops console ──────────────────────────────────────
// Mock by default. Flip with NEXT_PUBLIC_P2PMARKET_ADMIN_USE_MOCK=false to hit the
// live Go backend. NOTE: the p2pmarket admin surface is THIN — the only admin route
// is POST /api/p2p/admin/p2p/orders/:orderId/arbitrate (RBAC p2p.dispute.arbitrate).
// Listings + orders are read from member endpoints under /api/finance/p2p/*.
// Escrow holds funds and never lends (NL-6); arbitration enforces separation of
// duties (the arbiter must differ from the release approver) and is audited (NL-12).
// Money is BIGINT kobo (minor units) throughout.

import { env } from '@/config/env';
import { operationKey } from './idempotency';

const USE_MOCK = (process.env.NEXT_PUBLIC_P2PMARKET_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

// Admin (arbitration) lives at /api/p2p/admin/*.
function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/p2p/admin');
}
// Listings + orders are read from the member group at /api/finance/p2p/*.
function memberBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/finance/p2p');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 240) => new Promise((r) => setTimeout(r, ms));

async function getMember<T>(path: string): Promise<T> {
  const res = await fetch(`${memberBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function sendAdmin<T>(method: 'POST', path: string, body: unknown): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, {
    method,
    headers: { ...authHeaders(), 'Idempotency-Key': operationKey(method, path) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

export function formatNaira(kobo: number): string {
  const naira = (kobo ?? 0) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

// ── Types ────────────────────────────────────────────────────────────────────
export interface P2PMarketDashboard {
  listings_total: number;
  listings_open: number;
  orders_total: number;
  orders_in_escrow: number;
  orders_completed_30d: number;
  gmv_30d_kobo: number;
  escrow_held_kobo: number;
  disputes_open: number;
  avg_seller_rating: number;
  activity: { id: string; kind: string; label: string; ref?: string | null; created_at: string }[];
}

export type ListingStatus = 'open' | 'closed';
export interface ListingRecord {
  id: string;
  title: string;
  seller_masked: string;
  price_kobo: number;
  status: ListingStatus;
  seller_rating: number;
  created_at: string;
}

export type OrderStatus = 'in_escrow' | 'completed' | 'disputed' | 'refunded';
export interface OrderRecord {
  id: string;
  listing_title: string;
  buyer_masked: string;
  seller_masked: string;
  amount_kobo: number;
  status: OrderStatus;
  created_at: string;
}

export interface DisputeRecord {
  order_id: string;
  listing_title: string;
  buyer_masked: string;
  seller_masked: string;
  amount_kobo: number;
  evidence: string;
  raised_at: string;
}
export type ArbitrationDecision = 'RELEASE' | 'REFUND';
export interface ArbitrationResult { order_id: string; decision: ArbitrationDecision; audit_id: string; message: string; }

// ── Dashboard ────────────────────────────────────────────────────────────────
const DASHBOARD: P2PMarketDashboard = {
  listings_total: 3_410,
  listings_open: 2_180,
  orders_total: 9_820,
  orders_in_escrow: 142,
  orders_completed_30d: 1_640,
  gmv_30d_kobo: 88_400_000_00,
  escrow_held_kobo: 12_600_000_00,
  disputes_open: 7,
  avg_seller_rating: 4.4,
  activity: [
    { id: 'ev1', kind: 'completed', label: 'Order confirmed — escrow released to seller', ref: 'ord_5521', created_at: iso(0.4) },
    { id: 'ev2', kind: 'investigating', label: 'Buyer raised a dispute — order moved to arbitration', ref: 'ord_5510', created_at: iso(1.1) },
    { id: 'ev3', kind: 'reversed', label: 'Arbitration: REFUND — funds returned to buyer', ref: 'ord_5498', created_at: iso(3) },
  ],
};
export async function getP2PMarketDashboard(): Promise<P2PMarketDashboard> {
  if (USE_MOCK) { await delay(); return { ...DASHBOARD, activity: [...DASHBOARD.activity] }; }
  return getMember<P2PMarketDashboard>('/admin/dashboard');
}

// ── Listings ─────────────────────────────────────────────────────────────────
const LISTINGS: ListingRecord[] = [
  { id: 'lst_9001', title: 'iPhone 13 Pro 256GB', seller_masked: 'Seun K•••', price_kobo: 420_000_00, status: 'open', seller_rating: 4.7, created_at: iso(20) },
  { id: 'lst_8990', title: 'PS5 Disc Edition', seller_masked: 'Dapo F•••', price_kobo: 510_000_00, status: 'open', seller_rating: 4.2, created_at: iso(40) },
  { id: 'lst_8975', title: 'MacBook Air M2', seller_masked: 'Chika E•••', price_kobo: 920_000_00, status: 'closed', seller_rating: 4.9, created_at: iso(120) },
];
export async function listListings(opts?: { status?: string; q?: string }): Promise<ListingRecord[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...LISTINGS];
    if (opts?.status) rows = rows.filter((l) => l.status === opts.status);
    if (opts?.q) { const q = opts.q.toLowerCase(); rows = rows.filter((l) => l.title.toLowerCase().includes(q) || l.seller_masked.toLowerCase().includes(q) || l.id.includes(q)); }
    return rows;
  }
  return getMember<ListingRecord[]>('/p2p/listings');
}

// ── Orders ───────────────────────────────────────────────────────────────────
const ORDERS: OrderRecord[] = [
  { id: 'ord_5521', listing_title: 'iPhone 13 Pro 256GB', buyer_masked: 'Funke A•••', seller_masked: 'Seun K•••', amount_kobo: 420_000_00, status: 'completed', created_at: iso(2) },
  { id: 'ord_5510', listing_title: 'PS5 Disc Edition', buyer_masked: 'Musa I•••', seller_masked: 'Dapo F•••', amount_kobo: 510_000_00, status: 'disputed', created_at: iso(6) },
  { id: 'ord_5505', listing_title: 'MacBook Air M2', buyer_masked: 'Bola T•••', seller_masked: 'Chika E•••', amount_kobo: 920_000_00, status: 'in_escrow', created_at: iso(10) },
  { id: 'ord_5498', listing_title: 'AirPods Pro', buyer_masked: 'Ada N•••', seller_masked: 'Grace E•••', amount_kobo: 95_000_00, status: 'refunded', created_at: iso(48) },
];
export async function listOrders(opts?: { status?: string; q?: string }): Promise<OrderRecord[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...ORDERS];
    if (opts?.status) rows = rows.filter((o) => o.status === opts.status);
    if (opts?.q) { const q = opts.q.toLowerCase(); rows = rows.filter((o) => o.listing_title.toLowerCase().includes(q) || o.id.includes(q)); }
    return rows;
  }
  return getMember<OrderRecord[]>('/p2p/orders');
}

// ── Disputes (real admin arbitration endpoint) ───────────────────────────────
const DISPUTES: DisputeRecord[] = [
  { order_id: 'ord_5510', listing_title: 'PS5 Disc Edition', buyer_masked: 'Musa I•••', seller_masked: 'Dapo F•••', amount_kobo: 510_000_00, evidence: 'Item not as described — controller missing.', raised_at: iso(5) },
  { order_id: 'ord_5481', listing_title: 'Samsung S22', buyer_masked: 'Yemi S•••', seller_masked: 'Kemi D•••', amount_kobo: 380_000_00, evidence: 'Seller never shipped after 7 days.', raised_at: iso(30) },
];
export async function listDisputes(): Promise<DisputeRecord[]> {
  if (USE_MOCK) { await delay(); return DISPUTES.map((d) => ({ ...d })); }
  return getMember<DisputeRecord[]>('/admin/disputes');
}
export async function arbitrate(orderId: string, decision: ArbitrationDecision): Promise<ArbitrationResult> {
  if (USE_MOCK) {
    await delay();
    return { order_id: orderId, decision, audit_id: `aud_${Math.random().toString(36).slice(2, 10)}`, message: `Order ${orderId}: ${decision} — escrow ${decision === 'RELEASE' ? 'released to seller' : 'refunded to buyer'} (NL-6). Separation-of-duties enforced; recorded to immutable audit (NL-12).` };
  }
  // Real endpoint: POST /api/p2p/admin/p2p/orders/:orderId/arbitrate
  return sendAdmin<ArbitrationResult>('POST', `/p2p/orders/${orderId}/arbitrate`, { decision });
}
