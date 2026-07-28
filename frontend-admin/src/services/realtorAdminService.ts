// ── Admin — Realtor control-plane service ────────────────────────────────────
// Mock by default (mirrors fxAdminService / crowdfundingAdminService). Flip with
// NEXT_PUBLIC_REALTOR_ADMIN_USE_MOCK=false to hit the live admin endpoints.
// All money is integer minor units (kobo).

import { env } from '@/config/env';
import type {
  RealtorOverview, AdminListing, ModerationStatus,
  VerificationRequest, VerificationStatus, AdminPayment, EscrowAccount,
} from '@/types/realtorAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_REALTOR_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/realtor/admin');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}
const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

// ─── Mock datasets ────────────────────────────────────────────────────────────
const OVERVIEW: RealtorOverview = {
  listingsLive: 1842, pendingModeration: 3, pendingVerification: 5, activeLeases: 412,
  escrowHeldKobo: 84_500_000_00, payoutsDueKobo: 31_900_000_00, gmvKobo: 612_400_000_00,
  openDisputes: 2, fraudFlags: 1,
};

let MOD_QUEUE: AdminListing[] = [
  { id: 'mod_1', title: '2-Bedroom Flat, Gbagada Phase 2', area: 'Gbagada', city: 'Lagos', mode: 'long_rent', priceKobo: 1_800_000_00, verification: 'unverified', ownerName: 'Kingsway Realty', ownerVerified: false, riskFlags: ['Owner not yet verified', 'No ownership document'], submittedAt: new Date(Date.now() - 4 * 3_600_000).toISOString() },
  { id: 'mod_2', title: 'Studio Apartment, Surulere', area: 'Surulere', city: 'Lagos', mode: 'long_rent', priceKobo: 900_000_00, verification: 'document_backed', ownerName: 'Bola Adeyemi', ownerVerified: true, riskFlags: ['Possible duplicate of #4821'], submittedAt: new Date(Date.now() - 26 * 3_600_000).toISOString() },
  { id: 'mod_3', title: '4-Bed Duplex, Maitama (Off-plan)', area: 'Maitama', city: 'Abuja', mode: 'for_sale', priceKobo: 280_000_000_00, verification: 'document_backed', ownerName: 'Citadel Developments', ownerVerified: true, riskFlags: [], submittedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
];

let VERIF_QUEUE: VerificationRequest[] = [
  { id: 'v1', kind: 'owner', subjectName: 'Adaeze Okafor', documents: [{ label: 'Government ID', uploaded: true }, { label: 'Proof of address', uploaded: true }], status: 'pending', submittedAt: new Date(Date.now() - 6 * 3_600_000).toISOString() },
  { id: 'v2', kind: 'agent', subjectName: 'Tunde Bakare', documents: [{ label: 'ID', uploaded: true }, { label: 'REDAN cert', uploaded: false }], status: 'pending', submittedAt: new Date(Date.now() - 30 * 3_600_000).toISOString(), riskNote: 'Association certificate missing' },
  { id: 'v3', kind: 'property', subjectName: 'Block 4, Admiralty Way, Lekki', documents: [{ label: 'C of O', uploaded: true }, { label: 'Survey plan', uploaded: true }], status: 'pending', submittedAt: new Date(Date.now() - 50 * 3_600_000).toISOString() },
];

const PAYMENTS: AdminPayment[] = [
  { id: 'p1', reference: 'RL-9F2A11', kind: 'rent', amountKobo: 6_500_000_00, escrowHeldKobo: 650_000_00, status: 'paid', payer: 'Demo User', createdAt: new Date(Date.now() - 3_600_000).toISOString() },
  { id: 'p2', reference: 'RL-77C0E2', kind: 'shortlet', amountKobo: 260_000_00, escrowHeldKobo: 150_000_00, status: 'paid', payer: 'Chidi Eze', createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString() },
  { id: 'p3', reference: 'RL-12BB90', kind: 'payout', amountKobo: 3_900_000_00, escrowHeldKobo: 0, status: 'processing', payer: 'Owner: A. Okafor', createdAt: new Date(Date.now() - 5 * 3_600_000).toISOString() },
  { id: 'p4', reference: 'RL-44A1C3', kind: 'hotel', amountKobo: 220_000_00, escrowHeldKobo: 0, status: 'failed', payer: 'Funmi Bello', createdAt: new Date(Date.now() - 9 * 3_600_000).toISOString() },
];

const ESCROW: EscrowAccount[] = [
  { id: 'e1', leaseOrBooking: 'Lease · Lekki 3B', amountKobo: 650_000_00, status: 'held', heldSince: new Date(Date.now() - 8 * 86_400_000).toISOString() },
  { id: 'e2', leaseOrBooking: 'Shortlet · VI 2-bed', amountKobo: 150_000_00, status: 'release_requested', heldSince: new Date(Date.now() - 2 * 86_400_000).toISOString() },
  { id: 'e3', leaseOrBooking: 'Lease · Yaba self-con', amountKobo: 100_000_00, status: 'disputed', heldSince: new Date(Date.now() - 20 * 86_400_000).toISOString() },
];

// ─── API ──────────────────────────────────────────────────────────────────────
export async function getOverview(): Promise<RealtorOverview> {
  if (USE_MOCK) { await delay(); return { ...OVERVIEW }; }
  return getJson<RealtorOverview>('/overview');
}

export async function getModerationQueue(): Promise<AdminListing[]> {
  if (USE_MOCK) { await delay(); return [...MOD_QUEUE]; }
  return getJson<AdminListing[]>('/listings/pending');
}

export async function decideListing(id: string, decision: ModerationStatus): Promise<{ id: string }> {
  if (USE_MOCK) { await delay(320); MOD_QUEUE = MOD_QUEUE.filter((m) => m.id !== id); return { id }; }
  return postJson<{ id: string }>(`/listings/${id}/decision`, { decision });
}

export async function getVerificationQueue(): Promise<VerificationRequest[]> {
  if (USE_MOCK) { await delay(); return [...VERIF_QUEUE]; }
  return getJson<VerificationRequest[]>('/verifications');
}

export async function decideVerification(id: string, status: VerificationStatus): Promise<{ id: string }> {
  if (USE_MOCK) { await delay(300); VERIF_QUEUE = VERIF_QUEUE.filter((v) => v.id !== id); return { id }; }
  return postJson<{ id: string }>(`/verifications/${id}/decision`, { status });
}

export async function getPayments(): Promise<AdminPayment[]> {
  if (USE_MOCK) { await delay(); return [...PAYMENTS]; }
  return getJson<AdminPayment[]>('/payments');
}

export async function getEscrow(): Promise<EscrowAccount[]> {
  if (USE_MOCK) { await delay(); return [...ESCROW]; }
  return getJson<EscrowAccount[]>('/escrow');
}
