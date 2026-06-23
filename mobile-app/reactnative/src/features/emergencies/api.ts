// Estate Emergencies (Block 35) — types + dual mock/live api + constants.
import { api } from '@/api/client';
import { Colors } from '@/constants/colors';
import { generateIdempotencyKey } from '@/utils/idempotency';

export type EmergencyKind = 'panic' | 'medical' | 'fire' | 'security' | 'noise' | 'theft' | 'domestic' | 'other';
export type EmergencyStatus = 'open' | 'responding' | 'resolved';
export interface EmergencyAlert {
  id: string; estateId: string; reporterId: string; reporterName?: string;
  kind: EmergencyKind; description?: string; location?: string; status: EmergencyStatus; createdAt: string;
}
export interface CreateEmergencyInput { kind: EmergencyKind; description?: string; location?: string; idempotencyKey: string; }

export const USE_MOCK = (process.env.EXPO_PUBLIC_EMERGENCIES_USE_MOCK ?? 'true') !== 'false';
export const EMERGENCIES_API_BASE = '/api/v1/estate/emergencies';

export const KIND_META: Record<EmergencyKind, { label: string; icon: string }> = {
  panic:    { label: 'Panic',    icon: 'Siren' },
  medical:  { label: 'Medical',  icon: 'HeartPulse' },
  fire:     { label: 'Fire',     icon: 'Flame' },
  security: { label: 'Security', icon: 'ShieldAlert' },
  noise:    { label: 'Noise',    icon: 'Volume2' },
  theft:    { label: 'Theft',    icon: 'Hand' },
  domestic: { label: 'Domestic', icon: 'Home' },
  other:    { label: 'Other',    icon: 'TriangleAlert' },
};
export const STATUS_META: Record<EmergencyStatus, { label: string; color: string; bg: string }> = {
  open:       { label: 'Open',       color: Colors.error,     bg: Colors.errorContainer },
  responding: { label: 'Responding', color: '#B26B00',        bg: 'rgba(245,158,11,0.12)' },
  resolved:   { label: 'Resolved',   color: '#16A34A',        bg: 'rgba(22,163,74,0.12)' },
};

const H = 3_600_000, iso = (o: number) => new Date(Date.now() + o).toISOString();
let alerts: EmergencyAlert[] = [
  { id: 'e1', estateId: 'est_amber_court', reporterId: 'res_3', reporterName: 'Emeka Eze', kind: 'security', description: 'Two unknown individuals loitering near Block A.', location: 'Block A', status: 'responding', createdAt: iso(-0.5 * H) },
  { id: 'e2', estateId: 'est_amber_court', reporterId: 'res_2', reporterName: 'Ngozi Okeke', kind: 'noise', description: 'Loud party past midnight.', location: 'Block C, Flat 9', status: 'resolved', createdAt: iso(-30 * H) },
];
const latency = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const idem = (k?: string) => ({ headers: { 'Idempotency-Key': k ?? generateIdempotencyKey() } });

export async function listEmergencies(): Promise<EmergencyAlert[]> {
  if (USE_MOCK) { await latency(); return alerts.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)); }
  const { data } = await api.get<EmergencyAlert[]>(EMERGENCIES_API_BASE); return data;
}
export async function createEmergency(input: CreateEmergencyInput): Promise<EmergencyAlert> {
  if (USE_MOCK) {
    await latency(400);
    const a: EmergencyAlert = { id: `e_${Date.now()}`, estateId: 'est_amber_court', reporterId: 'res_demo', reporterName: 'You', kind: input.kind, description: input.description?.trim() || undefined, location: input.location?.trim() || undefined, status: 'open', createdAt: new Date().toISOString() };
    alerts = [a, ...alerts]; return { ...a };
  }
  const { data } = await api.post<EmergencyAlert>(EMERGENCIES_API_BASE, input, idem(input.idempotencyKey)); return data;
}
export async function resolveEmergency(id: string): Promise<EmergencyAlert> {
  if (USE_MOCK) { await latency(250); const a = alerts.find((x) => x.id === id); if (!a) throw new Error('Not found'); a.status = 'resolved'; return { ...a }; }
  const { data } = await api.post<EmergencyAlert>(`${EMERGENCIES_API_BASE}/${id}/resolve`, {}, idem()); return data;
}
