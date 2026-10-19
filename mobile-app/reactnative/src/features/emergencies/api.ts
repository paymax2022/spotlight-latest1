// Estate Emergencies (Block 35) — types + dual mock/live api + constants.
import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import { Colors } from '@/constants/tokens';
import { generateIdempotencyKey } from '@/utils/idempotency';

export type EmergencyKind = 'panic' | 'medical' | 'fire' | 'security' | 'noise' | 'theft' | 'domestic' | 'other';
export type EmergencyStatus = 'open' | 'responding' | 'resolved';
export interface EmergencyAlert {
  id: string; estateId: string; reporterId: string; reporterName?: string;
  kind: EmergencyKind; description?: string; location?: string; status: EmergencyStatus; createdAt: string;
}
export interface CreateEmergencyInput { kind: EmergencyKind; description?: string; location?: string; idempotencyKey: string; }

// The /api/v1/estate/emergencies handlers are live and query a real table, so this defaults
// to live: a forgotten flag fails visibly instead of inventing alerts. Set
// EXPO_PUBLIC_EMERGENCIES_USE_MOCK=true to force fixtures locally. NOTE: raising an alert only
// records a row — nothing pushes it to security or admins (see docs/audit/MOBILE_SIMULATED_WRITES.md).
export const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_EMERGENCIES_USE_MOCK, false);

// Emergencies/incidents are served by the resident-scoped frontend-web handlers
// under /api/v1/estate/emergencies (GET list, POST create, POST /{id}/resolve).
// The current resident's estate is derived SERVER-SIDE from the auth token
// (frontend-web/src/server/estate/resident.ts → getResidentContext), so the
// client never passes an estate ID.
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
const alerts: EmergencyAlert[] = [
  { id: 'e1', estateId: 'est_amber_court', reporterId: 'res_3', reporterName: 'Emeka Eze', kind: 'security', description: 'Two unknown individuals loitering near Block A.', location: 'Block A', status: 'responding', createdAt: iso(-0.5 * H) },
  { id: 'e2', estateId: 'est_amber_court', reporterId: 'res_2', reporterName: 'Ngozi Okeke', kind: 'noise', description: 'Loud party past midnight.', location: 'Block C, Flat 9', status: 'resolved', createdAt: iso(-30 * H) },
];
const latency = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// createEmergency and resolveEmergency have live route handlers, so fixture mode refuses
// loudly instead of reporting an alert raised or resolved that never reached the database —
// a faked "emergency sent" is the most dangerous thing to simulate. Mirrors frontend-admin's
// crowdfundingAdminService.ts NOT_IN_FIXTURE_MODE pattern.
const notInFixtureMode = (action: string) =>
  new Error(`${action} is unavailable in fixture mode: this app will not report an alert it did not send. Set EXPO_PUBLIC_EMERGENCIES_USE_MOCK=false to send this against the live backend.`);
const idem = (k?: string) => ({ headers: { 'Idempotency-Key': k ?? generateIdempotencyKey() } });

export async function listEmergencies(): Promise<EmergencyAlert[]> {
  if (USE_MOCK) { await latency(); return alerts.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)); }
  const { data } = await api.get<EmergencyAlert[]>(EMERGENCIES_API_BASE); return data;
}
export async function createEmergency(input: CreateEmergencyInput): Promise<EmergencyAlert> {
  if (USE_MOCK) throw notInFixtureMode('Sending an emergency alert');
  const { data } = await api.post<EmergencyAlert>(EMERGENCIES_API_BASE, input, idem(input.idempotencyKey)); return data;
}
// The resident-scoped handler exposes POST /api/v1/estate/emergencies/{id}/resolve
// (frontend-web/app/api/v1/estate/emergencies/[id]/resolve/route.ts), which sets
// status='resolved' and returns the updated alert.
export async function resolveEmergency(id: string): Promise<EmergencyAlert> {
  if (USE_MOCK) throw notInFixtureMode('Resolving an emergency alert');
  const { data } = await api.post<EmergencyAlert>(`${EMERGENCIES_API_BASE}/${id}/resolve`, {}, idem()); return data;
}
