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
export const VENDORS_API_BASE = '/api/v1/estate/vendors';
export const RATING_STAR_COLOR = '#EAB308';

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

export async function listVendors(): Promise<Vendor[]> {
  if (USE_MOCK) { await latency(); return vendors.slice().sort((a, b) => b.rating - a.rating); }
  const { data } = await api.get<Vendor[]>(VENDORS_API_BASE); return data;
}
export async function listJobs(): Promise<VendorJob[]> {
  if (USE_MOCK) { await latency(); return jobs.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)); }
  const { data } = await api.get<VendorJob[]>(`${VENDORS_API_BASE}/jobs`); return data;
}
export async function updateJobStatus(id: string, status: JobStatus): Promise<VendorJob> {
  if (USE_MOCK) { await latency(250); const j = jobs.find((x) => x.id === id); if (!j) throw new Error('Not found'); j.status = status; return { ...j }; }
  const { data } = await api.post<VendorJob>(`${VENDORS_API_BASE}/jobs/${id}/status`, { status }); return data;
}
