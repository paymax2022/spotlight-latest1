// ── Spotlight Realtor — Maintenance triangle data layer (V2) ─────────────────
// Tenant → manager → vendor SLA. Mock by default (REALTOR_USE_MOCK); real branch
// hits realtor_maintenance_requests (migration 20260620030000). Costs surface in
// the owner cockpit. Money is integer minor units.

import { createSupabaseClient } from '@/lib/supabase';
import { REALTOR_USE_MOCK } from './realtorEnv';
import type {
  MaintenanceRequest,
  NewMaintenanceDraft,
  MaintenanceStatus,
  MaintenanceEvent,
  VendorJob,
  QuoteDraft,
  VendorRef,
} from '../types/realtor.maintenance.types';

const USE_MOCK = REALTOR_USE_MOCK;
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const IMG = (s: string) => `https://picsum.photos/seed/${s}/600/450`;

/* eslint-disable @typescript-eslint/no-explicit-any */

const VENDOR: VendorRef = { id: 'vd_1', name: 'Sunrise Facilities', trade: 'Multi-trade', rating: 4.7, avatarUrl: IMG('vendor1'), phone: '0809 111 2222' };

// Ordered status spine for the timeline (skips terminal branches).
const SPINE: { key: MaintenanceStatus; label: string; by?: MaintenanceEvent['by'] }[] = [
  { key: 'submitted', label: 'Reported', by: 'tenant' },
  { key: 'manager_review', label: 'Manager review', by: 'manager' },
  { key: 'vendor_assigned', label: 'Vendor assigned', by: 'manager' },
  { key: 'quote_submitted', label: 'Quote received', by: 'vendor' },
  { key: 'quote_approved', label: 'Quote approved', by: 'manager' },
  { key: 'in_progress', label: 'Repair in progress', by: 'vendor' },
  { key: 'completed', label: 'Work completed', by: 'vendor' },
  { key: 'tenant_confirmed', label: 'Tenant confirmed', by: 'tenant' },
  { key: 'closed', label: 'Paid & closed', by: 'manager' },
];

export function buildTimeline(status: MaintenanceStatus): MaintenanceEvent[] {
  if (status === 'cancelled' || status === 'quote_rejected') {
    const head: MaintenanceEvent = { ...SPINE[0], state: 'done' };
    const tail: MaintenanceEvent = {
      key: status,
      label: status === 'cancelled' ? 'Cancelled' : 'Quote rejected',
      state: 'current',
    };
    return [head, tail];
  }
  const idx = SPINE.findIndex((s) => s.key === status);
  return SPINE.map<MaintenanceEvent>((s, i) => ({
    ...s,
    state: i < idx ? 'done' : i === idx ? 'current' : 'upcoming',
  }));
}

// ── Mock store ───────────────────────────────────────────────────────────────
const store: Record<string, MaintenanceRequest> = {};
function seed() {
  if (Object.keys(store).length) return;
  const r: MaintenanceRequest = {
    id: 'mr_seed1', unitLabel: 'Flat 3B', propertyName: 'Lekki Phase 1 Apartments', area: 'Lekki Phase 1',
    category: 'plumbing', urgency: 'high', title: 'Leaking kitchen sink',
    description: 'Water pooling under the kitchen sink cabinet since this morning.',
    media: [{ id: 'm1', url: IMG('leak1'), kind: 'image' }],
    status: 'quote_submitted', vendor: VENDOR, quoteAmount: 35_000_00,
    quoteNote: 'Replace worn P-trap and seals; ~1.5 hrs labour + parts.',
    completionEvidence: [], timeline: buildTimeline('quote_submitted'),
    createdAt: new Date(Date.now() - 86_400_000).toISOString(), emergencyBypass: false,
  };
  store[r.id] = r;
}

function mapRow(row: any): MaintenanceRequest {
  return {
    id: row.id, unitLabel: row.unit_label ?? '', propertyName: row.property_name ?? '', area: row.area ?? '',
    category: row.category, urgency: row.urgency, title: row.title, description: row.description ?? '',
    media: Array.isArray(row.media) ? row.media : [],
    status: row.status, vendor: row.vendor ?? undefined,
    quoteAmount: row.quote_amount_kobo != null ? Number(row.quote_amount_kobo) : undefined,
    quoteNote: row.quote_note ?? undefined,
    completionEvidence: Array.isArray(row.completion_evidence) ? row.completion_evidence : [],
    timeline: buildTimeline(row.status),
    rating: row.rating ?? undefined,
    createdAt: row.created_at, emergencyBypass: Boolean(row.emergency_bypass),
  };
}

// ── Tenant API ───────────────────────────────────────────────────────────────
export async function listRequests(): Promise<MaintenanceRequest[]> {
  if (USE_MOCK) { await delay(); seed(); return Object.values(store).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)); }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from('realtor_maintenance_requests').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function getRequest(id: string): Promise<MaintenanceRequest> {
  if (USE_MOCK) { await delay(180); seed(); const r = store[id]; if (!r) throw new Error('Request not found'); return r; }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from('realtor_maintenance_requests').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Request not found');
  return mapRow(data);
}

export async function createRequest(draft: NewMaintenanceDraft): Promise<MaintenanceRequest> {
  const emergency = draft.urgency === 'emergency';
  const initial: MaintenanceStatus = emergency ? 'vendor_assigned' : 'submitted';
  if (USE_MOCK) {
    await delay(520); seed();
    const id = `mr_${Date.now().toString(36)}`;
    const r: MaintenanceRequest = {
      id, unitLabel: 'Flat 3B', propertyName: 'Lekki Phase 1 Apartments', area: 'Lekki Phase 1',
      category: draft.category, urgency: draft.urgency, title: draft.title, description: draft.description,
      media: draft.mediaUris.map((u, i) => ({ id: `m${i}`, url: u, kind: 'image' as const })),
      status: initial, vendor: emergency ? VENDOR : undefined, completionEvidence: [],
      timeline: buildTimeline(initial), createdAt: new Date().toISOString(), emergencyBypass: emergency,
    };
    store[id] = r;
    return r;
  }
  const supabase = createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase.from('realtor_maintenance_requests').insert({
    tenant_id: user.id, category: draft.category, urgency: draft.urgency, title: draft.title,
    description: draft.description, media: draft.mediaUris.map((u, i) => ({ id: `m${i}`, url: u, kind: 'image' })),
    status: initial, emergency_bypass: emergency,
  }).select('*').single();
  if (error) throw error;
  return mapRow(data);
}

async function patch(id: string, status: MaintenanceStatus, extra: Record<string, unknown> = {}): Promise<MaintenanceRequest> {
  if (USE_MOCK) {
    await delay(360); seed();
    const r = store[id]; if (!r) throw new Error('Request not found');
    Object.assign(r, { status, timeline: buildTimeline(status) }, mapExtraToDomain(extra));
    return r;
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from('realtor_maintenance_requests')
    .update({ status, updated_at: new Date().toISOString(), ...extra }).eq('id', id).select('*').single();
  if (error) throw error;
  return mapRow(data);
}

function mapExtraToDomain(extra: Record<string, any>): Partial<MaintenanceRequest> {
  const out: Partial<MaintenanceRequest> = {};
  if ('quote_amount_kobo' in extra) out.quoteAmount = Number(extra.quote_amount_kobo);
  if ('quote_note' in extra) out.quoteNote = extra.quote_note;
  if ('vendor' in extra) out.vendor = extra.vendor;
  if ('rating' in extra) out.rating = extra.rating;
  if ('completion_evidence' in extra) out.completionEvidence = extra.completion_evidence;
  return out;
}

export const approveQuote = (id: string) => patch(id, 'quote_approved');
export const rejectQuote = (id: string) => patch(id, 'quote_rejected');
export const confirmCompletion = (id: string) => patch(id, 'tenant_confirmed');
export const cancelRequest = (id: string) => patch(id, 'cancelled');
export const rateRequest = (id: string, rating: number) => patch(id, 'closed', { rating });

// ── Vendor API ───────────────────────────────────────────────────────────────
export async function listVendorJobs(): Promise<VendorJob[]> {
  const requests = await listRequests();
  return requests
    .filter((r) => ['vendor_assigned', 'quote_submitted', 'quote_approved', 'in_progress', 'completed'].includes(r.status))
    .map((r) => ({
      id: r.id, title: r.title, category: r.category, urgency: r.urgency,
      propertyName: r.propertyName, unitLabel: r.unitLabel, area: r.area, status: r.status,
      quoteAmount: r.quoteAmount, payout: r.quoteAmount, createdAt: r.createdAt,
    }));
}

export const acceptJob = (id: string) => patch(id, 'vendor_assigned', { vendor: VENDOR });
export const submitQuote = (d: QuoteDraft) => patch(d.requestId, 'quote_submitted', { quote_amount_kobo: d.amount, quote_note: d.note, vendor: VENDOR });
export const startJob = (id: string) => patch(id, 'in_progress');
export function completeJob(id: string, evidenceUris: string[]) {
  const evidence = evidenceUris.map((u, i) => ({ id: `e${i}`, url: u, kind: 'image' as const }));
  return patch(id, 'completed', { completion_evidence: evidence });
}
