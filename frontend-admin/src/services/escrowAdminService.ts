// ── Admin — Paymax Social P2P Escrow (dispute arbitration) control-plane ───────
// Mock by default (mirrors events / savings admin services). Flip with
// NEXT_PUBLIC_SOCIAL_USE_MOCK=false to hit the live Go backend at
// /api/p2p/admin/* (escrow) — also reachable as /api/social/admin/escrow*.
// RBAC: p2p.admin.* gates wired on the sidebar.
// Money is BIGINT kobo (minor units). Surfaces NL-6 (escrow holds, never lends),
// NL-10 (KYC/AML), NL-12 (immutable audit). Separation-of-duties enforced on
// arbitration: the arbitrator must differ from the underlying release approver.

import { env } from '@/config/env';
import type {
  EscrowDashboard,
  DisputeListItem,
  DisputeDetail,
  ArbitrationDecision,
  ArbitrationResult,
  EscrowFraudSignal,
  EscrowFraudAction,
  EscrowFraudActionResult,
} from '@/types/escrowAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_SOCIAL_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/p2p/admin');
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
const isoAhead = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const aud = () => `aud_${Math.random().toString(36).slice(2, 10)}`;

// The currently-acting arbitrator (mock). Used to enforce separation-of-duties:
// an arbitrator cannot decide a dispute whose release they previously approved.
const CURRENT_ARBITRATOR = 'admin:you•••';

// ════════════════════════════════════════════════════════════════════════════
// A · Dashboard / oversight
// ════════════════════════════════════════════════════════════════════════════
const DASHBOARD: EscrowDashboard = {
  total_held_kobo: 248_600_000_00,
  held_count: 1_842,
  released_30d_kobo: 1_912_400_000_00,
  released_30d_count: 14_220,
  refunded_30d_kobo: 188_300_000_00,
  refunded_30d_count: 1_120,
  disputed_open_kobo: 42_700_000_00,
  disputed_open_count: 86,
  ledger_held_kobo: 248_600_000_00,
  custody_balance_kobo: 248_612_400_00,
  delta_kobo: 12_400_00,
  avg_resolution_hours: 38.4,
  dispute_release_rate: 0.58,
  fraud_open: 11,
  state_mix: [
    { state: 'held', count: 1_842, value_kobo: 248_600_000_00 },
    { state: 'released', count: 14_220, value_kobo: 1_912_400_000_00 },
    { state: 'refunded', count: 1_120, value_kobo: 188_300_000_00 },
    { state: 'disputed', count: 86, value_kobo: 42_700_000_00 },
  ],
  resolution_trend: Array.from({ length: 14 }).map((_, i) => ({
    date: dateStr(13 - i),
    opened: 6 + Math.round(Math.abs(Math.sin(i / 2) * 6)),
    resolved: 5 + Math.round(Math.abs(Math.cos(i / 2) * 5)),
  })),
  activity: [
    { id: 'es1', kind: 'dispute_opened', label: 'Dispute opened — "iPhone 15 Pro (swap)" not delivered', ref: 'dsp_5521', created_at: iso(0.5) },
    { id: 'es2', kind: 'dispute_resolved', label: 'Dispute resolved in buyer\'s favour — escrow REFUNDED (NL-6)', ref: 'dsp_5480', created_at: iso(2.1) },
    { id: 'es3', kind: 'released', label: 'Escrow released to seller on buyer confirmation', ref: 'esc_8841', created_at: iso(3.4) },
    { id: 'es4', kind: 'mule_flag', label: 'Mule-account pattern flagged — funnel into single payout account (AML)', ref: 'fr_3310', created_at: iso(6) },
    { id: 'es5', kind: 'hold_created', label: 'New escrow hold created on P2P listing checkout', ref: 'esc_8902', created_at: iso(9) },
  ],
};
export async function getEscrowDashboard(): Promise<EscrowDashboard> {
  if (USE_MOCK) { await delay(); return { ...DASHBOARD, state_mix: [...DASHBOARD.state_mix], resolution_trend: [...DASHBOARD.resolution_trend], activity: [...DASHBOARD.activity] }; }
  return getJson<EscrowDashboard>('/escrow/dashboard');
}

// ════════════════════════════════════════════════════════════════════════════
// B · Disputes list + detail (arbitration console)
// ════════════════════════════════════════════════════════════════════════════
const DISPUTES: DisputeListItem[] = [
  { id: 'dsp_5521', escrow_id: 'esc_9001', listing_title: 'iPhone 15 Pro (swap)', buyer_masked: 'Emeka O•••', seller_masked: 'GadgetPlug•••', amount_kobo: 720_000_00, status: 'open', escrow_state: 'disputed', reason: 'not_delivered', opened_at: iso(0.5), sla_due_at: isoAhead(47), evidence_count: 3, assigned_to_masked: null, created_at: iso(0.5) },
  { id: 'dsp_5530', escrow_id: 'esc_9010', listing_title: 'PS5 + 2 pads', buyer_masked: 'Funke A•••', seller_masked: 'ConsoleHub•••', amount_kobo: 480_000_00, status: 'in_review', escrow_state: 'disputed', reason: 'not_as_described', opened_at: iso(20), sla_due_at: isoAhead(28), evidence_count: 5, assigned_to_masked: 'admin:bola•••', created_at: iso(20) },
  { id: 'dsp_5540', escrow_id: 'esc_9020', listing_title: 'Designer sneakers (UK9)', buyer_masked: 'Ibrahim K•••', seller_masked: 'KicksLagos•••', amount_kobo: 145_000_00, status: 'awaiting_evidence', escrow_state: 'disputed', reason: 'not_as_described', opened_at: iso(40), sla_due_at: isoAhead(8), evidence_count: 2, assigned_to_masked: 'admin:you•••', created_at: iso(40) },
  { id: 'dsp_5480', escrow_id: 'esc_8980', listing_title: 'Concert ticket (VIP)', buyer_masked: 'Ngozi E•••', seller_masked: 'TicketGuy•••', amount_kobo: 95_000_00, status: 'resolved_refund', escrow_state: 'refunded', reason: 'unauthorized', opened_at: iso(72), sla_due_at: iso(24), evidence_count: 4, assigned_to_masked: 'admin:bola•••', created_at: iso(72) },
];
export async function listDisputes(opts?: { status?: string; reason?: string; q?: string }): Promise<DisputeListItem[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...DISPUTES];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.reason) rows = rows.filter((r) => r.reason === opts.reason);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.listing_title.toLowerCase().includes(q) || r.buyer_masked.toLowerCase().includes(q) || r.seller_masked.toLowerCase().includes(q) || r.id.includes(q) || r.escrow_id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.reason) qs.set('reason', opts.reason);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<DisputeListItem[]>(`/disputes${qs.toString() ? `?${qs}` : ''}`);
}

export async function getDispute(id: string): Promise<DisputeDetail> {
  if (USE_MOCK) {
    await delay();
    const base = DISPUTES.find((d) => d.id === id) ?? DISPUTES[0];
    // dsp_5521 was released-approved by the current arbitrator → separation-of-duties block
    const releaseApprover = base.id === 'dsp_5521' ? CURRENT_ARBITRATOR : 'admin:bola•••';
    return {
      ...base,
      id,
      description: 'Buyer reports the item never arrived after marking the order shipped. Seller provided a courier tracking reference that shows no movement for 6 days.',
      buyer_kyc_tier: 'tier2',
      seller_kyc_tier: 'tier1',
      seller_rating: 4.2,
      buyer_prior_disputes: 1,
      seller_prior_disputes: 3,
      release_approver_masked: releaseApprover,
      current_arbitrator_masked: base.assigned_to_masked,
      evidence: [
        { id: 'ev1', from: 'buyer', submitter_masked: base.buyer_masked, kind: 'message', note: 'Item never arrived. Seller stopped responding after I paid into escrow.', at: iso(0.4) },
        { id: 'ev2', from: 'seller', submitter_masked: base.seller_masked, kind: 'tracking', note: 'Shipped via GIG Logistics. Tracking: GIG-••••2207.', attachment_masked: 'tracking_GIG-••••2207.pdf', at: iso(0.3) },
        { id: 'ev3', from: 'system', submitter_masked: 'system', kind: 'system_log', note: 'Courier API shows no scan events for 6 days. Escrow auto-moved HELD → DISPUTED at buyer request.', at: iso(0.5) },
      ],
      timeline: [
        { id: 't1', status: 'held', label: 'Escrow hold created on checkout — funds in buyer held sub-balance (NL-6)', actor_masked: base.buyer_masked, audit_id: 'aud_h001', at: iso(96) },
        { id: 't2', status: 'disputed', label: 'Buyer raised dispute — escrow HELD → DISPUTED', actor_masked: base.buyer_masked, audit_id: 'aud_d001', at: iso(0.5) },
        { id: 't3', status: 'open', label: 'Dispute entered arbitration queue', actor_masked: 'system', audit_id: 'aud_q001', at: iso(0.5) },
      ],
    };
  }
  return getJson<DisputeDetail>(`/disputes/${id}`);
}

export async function arbitrateDispute(id: string, decision: ArbitrationDecision, note?: string): Promise<ArbitrationResult> {
  if (USE_MOCK) {
    await delay();
    // Separation-of-duties: cannot release/refund a dispute whose underlying
    // release the current arbitrator previously approved (NL-12 + four-eyes).
    if ((decision === 'release' || decision === 'refund') && id === 'dsp_5521') {
      throw new Error('Separation-of-duties violation: you approved the underlying release for this escrow and cannot also arbitrate it. Reassign to a different arbitrator.');
    }
    if (decision === 'request_evidence') {
      return { id, status: 'awaiting_evidence', escrow_state: 'disputed', audit_id: aud(), message: `Dispute ${id}: evidence requested from both parties. Escrow remains HELD/DISPUTED — Paymax never funds the gap (NL-6). Recorded to immutable audit (NL-12).` };
    }
    if (decision === 'assign') {
      return { id, status: 'in_review', escrow_state: 'disputed', audit_id: aud(), message: `Dispute ${id}: assigned to arbitrator ${CURRENT_ARBITRATOR}. Recorded to immutable audit (NL-12).` };
    }
    const status = decision === 'release' ? 'resolved_release' : 'resolved_refund';
    const escrow_state = decision === 'release' ? 'released' : 'refunded';
    return { id, status, escrow_state, audit_id: aud(), message: `Dispute ${id} arbitrated → ${decision.toUpperCase()}. Escrow ${escrow_state.toUpperCase()} (DISPUTED → ${escrow_state.toUpperCase()}). Holds only, never lends (NL-6). Recorded to immutable audit (NL-12).` };
  }
  return sendJson<ArbitrationResult>('POST', `/disputes/${id}/arbitrate`, { decision, note });
}

// ════════════════════════════════════════════════════════════════════════════
// C · Escrow fraud — mule / AML detection
// ════════════════════════════════════════════════════════════════════════════
const FRAUD: EscrowFraudSignal[] = [
  { id: 'fr_3310', escrow_id: null, kind: 'mule_account', subject_masked: '7 buyer accounts•••', detail: 'Multiple buyer accounts funnel released escrow into one payout bank account — classic mule pattern', severity: 'critical', amount_kobo: 4_200_000_00, status: 'open', created_at: iso(2) },
  { id: 'fr_3320', escrow_id: 'esc_9010', kind: 'collusive_dispute', subject_masked: 'buyer+seller•••', detail: 'Buyer and seller share device fingerprint — dispute likely collusive to extract refund', severity: 'high', amount_kobo: 480_000_00, status: 'investigating', created_at: iso(8) },
  { id: 'fr_3330', escrow_id: null, kind: 'structuring', subject_masked: 'wlt Sani•••', detail: '14 escrow checkouts each just under the AML reporting threshold within 24h', severity: 'high', amount_kobo: 6_800_000_00, status: 'open', created_at: iso(12) },
  { id: 'fr_3340', escrow_id: 'esc_8841', kind: 'rapid_release', subject_masked: 'esc_8841•••', detail: 'Release requested seconds after hold on a brand-new high-value listing', severity: 'medium', amount_kobo: 720_000_00, status: 'cleared', created_at: iso(40) },
];
export async function listEscrowFraud(opts?: { status?: string; kind?: string; q?: string }): Promise<EscrowFraudSignal[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...FRAUD];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.kind) rows = rows.filter((r) => r.kind === opts.kind);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.subject_masked.toLowerCase().includes(q) || r.id.includes(q) || (r.escrow_id ?? '').includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.kind) qs.set('kind', opts.kind);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<EscrowFraudSignal[]>(`/escrow/fraud${qs.toString() ? `?${qs}` : ''}`);
}
export async function decideEscrowFraud(id: string, action: EscrowFraudAction, note?: string): Promise<EscrowFraudActionResult> {
  if (USE_MOCK) {
    await delay();
    const status = action === 'investigate' ? 'investigating' : action === 'clear' ? 'cleared' : 'blocked';
    return { id, status, audit_id: aud(), message: `Escrow fraud signal ${id}: ${action} applied. Recorded to immutable audit (NL-12).` };
  }
  return sendJson<EscrowFraudActionResult>('POST', `/escrow/fraud/${id}/action`, { action, note });
}
