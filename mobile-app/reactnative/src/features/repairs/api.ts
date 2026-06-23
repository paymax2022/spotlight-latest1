// Estate Maintenance / Repairs (Block 32) — types + dual mock/live api + constants.
import { api } from '@/api/client';
import { Colors } from '@/constants/colors';
import { generateIdempotencyKey } from '@/utils/idempotency';

export type RepairCategory = 'plumbing' | 'electrical' | 'gate' | 'generator' | 'elevator' | 'water' | 'waste' | 'road' | 'pest' | 'facility' | 'other';
export type RepairUrgency = 'low' | 'medium' | 'high';
export type RepairStatus = 'reported' | 'inspection' | 'assigned' | 'in_progress' | 'completed' | 'reopened' | 'cancelled';

export interface RepairUpdate { id: string; status: RepairStatus | string; note?: string; byName?: string; createdAt: string; }
export interface RepairRequest {
  id: string; estateId: string; reporterId: string; reporterName?: string;
  category: RepairCategory; description: string; urgency: RepairUrgency; status: RepairStatus;
  costEstimateKobo?: number; createdAt: string; updates?: RepairUpdate[];
}
export interface CreateRepairInput { category: RepairCategory; description: string; urgency: RepairUrgency; idempotencyKey: string; }
export interface AddRepairUpdateInput { status: RepairStatus; note?: string; idempotencyKey: string; }

export const USE_MOCK = (process.env.EXPO_PUBLIC_REPAIRS_USE_MOCK ?? 'true') !== 'false';
export const REPAIRS_API_BASE = '/api/v1/estate/repairs';

export const CATEGORY_META: Record<RepairCategory, { label: string; icon: string }> = {
  plumbing:  { label: 'Plumbing',  icon: 'Droplets' },
  electrical:{ label: 'Electrical',icon: 'Zap' },
  gate:      { label: 'Gate',      icon: 'DoorClosed' },
  generator: { label: 'Generator', icon: 'Fuel' },
  elevator:  { label: 'Elevator',  icon: 'MoveVertical' },
  water:     { label: 'Water',     icon: 'Waves' },
  waste:     { label: 'Waste',     icon: 'Trash2' },
  road:      { label: 'Road',      icon: 'Construction' },
  pest:      { label: 'Pest',      icon: 'Bug' },
  facility:  { label: 'Facility',  icon: 'Building2' },
  other:     { label: 'Other',     icon: 'Wrench' },
};
export const URGENCY_META: Record<RepairUrgency, { label: string; color: string; bg: string }> = {
  low:    { label: 'Low',    color: Colors.teal,    bg: Colors.iconBgTeal },
  medium: { label: 'Medium', color: '#B26B00',      bg: 'rgba(245,158,11,0.12)' },
  high:   { label: 'High',   color: Colors.error,   bg: Colors.errorContainer },
};
export const STATUS_META: Record<RepairStatus, { label: string; color: string; bg: string }> = {
  reported:    { label: 'Reported',    color: Colors.outline,   bg: Colors.surfaceContainerLow },
  inspection:  { label: 'Inspection',  color: Colors.secondary, bg: Colors.iconBgBlue },
  assigned:    { label: 'Assigned',    color: Colors.secondary, bg: Colors.iconBgBlue },
  in_progress: { label: 'In progress', color: '#B26B00',        bg: 'rgba(245,158,11,0.12)' },
  completed:   { label: 'Completed',   color: '#16A34A',        bg: 'rgba(22,163,74,0.12)' },
  reopened:    { label: 'Reopened',    color: Colors.error,     bg: Colors.errorContainer },
  cancelled:   { label: 'Cancelled',   color: Colors.outline,   bg: Colors.surfaceContainerLow },
};
export const STATUS_FLOW: RepairStatus[] = ['reported', 'inspection', 'assigned', 'in_progress', 'completed'];

const H = 3_600_000, iso = (o: number) => new Date(Date.now() + o).toISOString();
let repairs: RepairRequest[] = [
  { id: 'r1', estateId: 'est_amber_court', reporterId: 'res_2', reporterName: 'Ngozi Okeke', category: 'generator', description: 'Estate generator tripping every evening at peak load.', urgency: 'high', status: 'in_progress', costEstimateKobo: 4_500_000, createdAt: iso(-48 * H), updates: [
    { id: 'u1', status: 'inspection', note: 'Technician inspected the AVR.', byName: 'Estate Admin', createdAt: iso(-40 * H) },
    { id: 'u2', status: 'in_progress', note: 'Awaiting replacement AVR part.', byName: 'Estate Admin', createdAt: iso(-20 * H) },
  ] },
  { id: 'r2', estateId: 'est_amber_court', reporterId: 'res_4', reporterName: 'Tunde Bello', category: 'road', description: 'Pothole near Gate B is widening after the rains.', urgency: 'medium', status: 'reported', createdAt: iso(-6 * H), updates: [] },
];
const latency = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const idem = (k?: string) => ({ headers: { 'Idempotency-Key': k ?? generateIdempotencyKey() } });

export async function listRepairs(): Promise<RepairRequest[]> {
  if (USE_MOCK) { await latency(); return repairs.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).map((r) => ({ ...r, updates: undefined })); }
  const { data } = await api.get<RepairRequest[]>(REPAIRS_API_BASE); return data;
}
export async function getRepair(id: string): Promise<RepairRequest> {
  if (USE_MOCK) { await latency(250); const r = repairs.find((x) => x.id === id); if (!r) throw new Error('Not found'); return { ...r, updates: (r.updates ?? []).slice() }; }
  const { data } = await api.get<RepairRequest>(`${REPAIRS_API_BASE}/${id}`); return data;
}
export async function createRepair(input: CreateRepairInput): Promise<RepairRequest> {
  if (USE_MOCK) {
    await latency(400);
    const r: RepairRequest = { id: `r_${Date.now()}`, estateId: 'est_amber_court', reporterId: 'res_demo', reporterName: 'You', category: input.category, description: input.description.trim(), urgency: input.urgency, status: 'reported', createdAt: new Date().toISOString(), updates: [] };
    repairs = [r, ...repairs]; return { ...r };
  }
  const { data } = await api.post<RepairRequest>(REPAIRS_API_BASE, input, idem(input.idempotencyKey)); return data;
}
export async function addRepairUpdate(id: string, input: AddRepairUpdateInput): Promise<RepairRequest> {
  if (USE_MOCK) {
    await latency(300); const r = repairs.find((x) => x.id === id); if (!r) throw new Error('Not found');
    r.status = input.status; r.updates = [...(r.updates ?? []), { id: `u_${Date.now()}`, status: input.status, note: input.note?.trim() || undefined, byName: 'You', createdAt: new Date().toISOString() }];
    return { ...r, updates: r.updates.slice() };
  }
  const { data } = await api.post<RepairRequest>(`${REPAIRS_API_BASE}/${id}/updates`, input, idem(input.idempotencyKey)); return data;
}
