// Estate Vendors / Artisans (Block 37) — types + dual mock/live api + constants.
import { api } from '@/api/client';
import { Colors } from '@/constants/colors';

export type VendorStatus = 'pending' | 'verified' | 'suspended';
export type JobStatus = 'available' | 'accepted' | 'rejected' | 'en_route' | 'in_progress' | 'completed' | 'paid';

export interface Vendor {
  id: string; estateId: string; name: string; category: string; phone?: string;
  status: VendorStatus; rating: number;
}
export interface VendorJob {
  id: string; estateId: string; vendorId: string; vendorName?: string;
  repairRequestId?: string; status: JobStatus; amountKobo: number; createdAt: string;
}

export const USE_MOCK = (process.env.EXPO_PUBLIC_VENDORS_USE_MOCK ?? 'true') !== 'false';

// Vendors/Artisans are NOT a standalone backend module — they are nested
// under the Estate module (backend/internal/app/finance_routes.go: estGroup :=
// finance.Group("/estate"); backend/internal/estate/handler.go:
// ListVendors/CreateVendor/VerifyVendor take :id (estate); the vendor
// self-service suite OnboardVendor/GetVendorProfile/ListVendorJobs/
// AssignVendorJob/AcceptVendorJob/... also take :id (estate)). There is no
// flat /vendors or /vendor namespace and no frontend-web proxy for
// /api/v1/estate/vendors|vendor — the blanket rewrite only covers
// /api/finance/:path*.
// MISSING: a shared estate-context provider; DEFAULT_ESTATE_ID is a stopgap
// (mirrors the election/meetings convention) until multi-estate selection ships.
export const DEFAULT_ESTATE_ID = 'est_amber_court';
export const VENDORS_API_BASE = `/api/finance/estate/${DEFAULT_ESTATE_ID}/vendors`; // admin directory (GET)
export const VENDOR_APP_BASE = `/api/finance/estate/${DEFAULT_ESTATE_ID}/vendor`;   // vendor self-service (Block 42)
export const RATING_STAR_COLOR = '#EAB308';

// Maps a target JobStatus to its backend transition endpoint (Block 42).
export const JOB_STATUS_ACTION: Record<JobStatus, string> = {
  accepted: 'accept', rejected: 'reject', en_route: 'checkin',
  in_progress: 'start', completed: 'complete', paid: 'payout', available: '',
};

export const VENDOR_CATEGORY_META: Record<string, { label: string; icon: string }> = {
  general:    { label: 'General',    icon: 'Wrench' },
  plumbing:   { label: 'Plumbing',   icon: 'Droplets' },
  electrical: { label: 'Electrical', icon: 'Zap' },
  cleaning:   { label: 'Cleaning',   icon: 'Sparkles' },
  security:   { label: 'Security',   icon: 'ShieldCheck' },
  landscaping:{ label: 'Landscaping',icon: 'Trees' },
  generator:  { label: 'Generator',  icon: 'Fuel' },
  painting:   { label: 'Painting',   icon: 'PaintRoller' },
};
export const VENDOR_STATUS_META: Record<VendorStatus, { label: string; color: string; bg: string }> = {
  pending:   { label: 'Pending',   color: '#B26B00',      bg: 'rgba(245,158,11,0.12)' },
  verified:  { label: 'Verified',  color: '#16A34A',      bg: 'rgba(22,163,74,0.12)' },
  suspended: { label: 'Suspended', color: Colors.error,   bg: Colors.errorContainer },
};
export const JOB_STATUS_META: Record<JobStatus, { label: string; color: string; bg: string }> = {
  available:   { label: 'Available',   color: Colors.outline,   bg: Colors.surfaceContainerLow },
  accepted:    { label: 'Accepted',    color: Colors.secondary, bg: Colors.iconBgBlue },
  rejected:    { label: 'Rejected',    color: Colors.error,     bg: Colors.errorContainer },
  en_route:    { label: 'En route',    color: Colors.secondary, bg: Colors.iconBgBlue },
  in_progress: { label: 'In progress', color: '#B26B00',        bg: 'rgba(245,158,11,0.12)' },
  completed:   { label: 'Completed',   color: '#16A34A',        bg: 'rgba(22,163,74,0.12)' },
  paid:        { label: 'Paid',        color: Colors.teal,      bg: Colors.iconBgTeal },
};

// Vendor self-service lifecycle (Block 42): the actions a vendor may take from
// each job status, in order. Empty array = terminal/no vendor action.
export const NEXT_JOB_ACTIONS: Record<JobStatus, { status: JobStatus; label: string; tone: 'primary' | 'danger' }[]> = {
  available:   [{ status: 'accepted', label: 'Accept', tone: 'primary' }, { status: 'rejected', label: 'Decline', tone: 'danger' }],
  accepted:    [{ status: 'en_route', label: 'Start travel', tone: 'primary' }],
  en_route:    [{ status: 'in_progress', label: 'Begin work', tone: 'primary' }],
  in_progress: [{ status: 'completed', label: 'Mark complete', tone: 'primary' }],
  completed:   [],
  rejected:    [],
  paid:        [],
};

const H = 3_600_000, iso = (o: number) => new Date(Date.now() + o).toISOString();
const vendors: Vendor[] = [
  { id: 'v1', estateId: 'est_amber_court', name: 'Chukwu Plumbing Works', category: 'plumbing', phone: '+2348031234567', status: 'verified', rating: 4.6 },
  { id: 'v2', estateId: 'est_amber_court', name: 'BrightSpark Electricals', category: 'electrical', phone: '+2348039876543', status: 'verified', rating: 4.8 },
  { id: 'v3', estateId: 'est_amber_court', name: 'GreenScape Landscaping', category: 'landscaping', phone: '+2348021112222', status: 'verified', rating: 4.3 },
  { id: 'v4', estateId: 'est_amber_court', name: 'PowerGen Services', category: 'generator', phone: '+2348025556666', status: 'pending', rating: 0 },
];
let jobs: VendorJob[] = [
  { id: 'j1', estateId: 'est_amber_court', vendorId: 'v2', vendorName: 'BrightSpark Electricals', repairRequestId: 'r1', status: 'in_progress', amountKobo: 4_500_000, createdAt: iso(-20 * H) },
  { id: 'j2', estateId: 'est_amber_court', vendorId: 'v1', vendorName: 'Chukwu Plumbing Works', status: 'completed', amountKobo: 1_200_000, createdAt: iso(-96 * H) },
];
const latency = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// jobFromApi maps the snake_case backend job payload to the client shape.
function jobFromApi(r: any): VendorJob {
  return {
    id: r.id, estateId: r.estate_id, vendorId: r.vendor_id,
    vendorName: r.vendor_name ?? undefined,
    repairRequestId: r.repair_request_id ?? undefined,
    status: r.status as JobStatus,
    amountKobo: Number(r.amount_kobo ?? 0),
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}

export async function listVendors(): Promise<Vendor[]> {
  if (USE_MOCK) { await latency(); return vendors.slice().sort((a, b) => b.rating - a.rating); }
  const res = await api.get(VENDORS_API_BASE);
  const rows = (res.data?.data ?? res.data ?? []) as any[];
  return rows.map((r) => ({ id: r.id, estateId: r.estate_id, name: r.name, category: r.category, phone: r.phone ?? undefined, status: r.status as VendorStatus, rating: Number(r.rating ?? 0) }));
}

export async function listJobs(): Promise<VendorJob[]> {
  if (USE_MOCK) { await latency(); return jobs.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)); }
  const res = await api.get(`${VENDOR_APP_BASE}/jobs`);
  const rows = (res.data?.data ?? res.data ?? []) as any[];
  return rows.map(jobFromApi);
}

// updateJobStatus advances a job via the matching backend transition endpoint.
// 'paid' is the payout money path and requires an Idempotency-Key header.
export async function updateJobStatus(id: string, status: JobStatus): Promise<VendorJob> {
  if (USE_MOCK) { await latency(250); const j = jobs.find((x) => x.id === id); if (!j) throw new Error('Not found'); j.status = status; return { ...j }; }
  const action = JOB_STATUS_ACTION[status];
  if (!action) throw new Error(`no transition for status ${status}`);
  const headers = status === 'paid' ? { 'Idempotency-Key': `payout:${id}` } : undefined;
  const { data } = await api.post(`${VENDOR_APP_BASE}/jobs/${id}/${action}`, {}, { headers });
  return jobFromApi(data);
}

// ── Block 42 vendor self-service ──────────────────────────────────────────────
export interface OnboardVendorInput { businessName: string; category?: string; phone?: string; specialties?: string[]; }

export async function onboardVendor(input: OnboardVendorInput): Promise<Vendor> {
  if (USE_MOCK) { await latency(400); const v: Vendor = { id: `v_${Date.now()}`, estateId: 'est_amber_court', name: input.businessName, category: input.category ?? 'general', phone: input.phone, status: 'pending', rating: 0 }; vendors.push(v); return { ...v }; }
  const { data } = await api.post(`${VENDOR_APP_BASE}/onboard`, {
    business_name: input.businessName, category: input.category, phone: input.phone, specialties: input.specialties ?? [],
  });
  return { id: data.id, estateId: data.estate_id, name: data.name, category: data.category, phone: data.phone ?? undefined, status: data.status as VendorStatus, rating: Number(data.rating ?? 0) };
}

export interface VendorEarnings { paidJobs: number; totalEarnedKobo: number; openJobs: number; }

export async function getVendorEarnings(): Promise<VendorEarnings> {
  if (USE_MOCK) { await latency(); const paid = jobs.filter((j) => j.status === 'paid'); return { paidJobs: paid.length, totalEarnedKobo: paid.reduce((s, j) => s + j.amountKobo, 0), openJobs: jobs.filter((j) => !['paid', 'rejected'].includes(j.status)).length }; }
  const { data } = await api.get(`${VENDOR_APP_BASE}/earnings`);
  return { paidJobs: Number(data.paid_jobs ?? 0), totalEarnedKobo: Number(data.total_earned_kobo ?? 0), openJobs: Number(data.open_jobs ?? 0) };
}

export async function submitQuote(id: string, amountKobo: number): Promise<VendorJob> {
  if (USE_MOCK) { await latency(); const j = jobs.find((x) => x.id === id); if (!j) throw new Error('Not found'); j.amountKobo = amountKobo; return { ...j }; }
  const { data } = await api.post(`${VENDOR_APP_BASE}/jobs/${id}/quote`, { amount_kobo: amountKobo });
  return jobFromApi(data);
}
