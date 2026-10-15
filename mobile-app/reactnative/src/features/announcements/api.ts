// Estate Announcements (Block 34) — types + dual mock/live api + constants.
import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import { Colors } from '@/constants/tokens';
import { generateIdempotencyKey } from '@/utils/idempotency';

export type AnnouncementKind = 'general' | 'emergency' | 'security' | 'payment' | 'maintenance' | 'meeting' | 'election';
export interface Announcement {
  id: string; estateId: string; title: string; body: string; kind: AnnouncementKind;
  createdBy: string; createdByName?: string; createdAt: string; read: boolean;
}
export interface CreateAnnouncementInput { title: string; body: string; kind: AnnouncementKind; idempotencyKey: string; }

// The /api/v1/estate/announcements handlers are live and query real tables, so this
// defaults to live: a forgotten flag fails visibly instead of inventing notices. Set
// EXPO_PUBLIC_ANNOUNCEMENTS_USE_MOCK=true to force fixtures locally.
export const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_ANNOUNCEMENTS_USE_MOCK, false);

// Announcements are served by the resident-scoped frontend-web handlers under
// /api/v1/estate/announcements (GET list, POST create, GET/POST /{id},
// POST /{id}/read). The current resident's estate is derived SERVER-SIDE from
// the auth token (frontend-web/src/server/estate/resident.ts →
// getResidentContext), so the client never passes an estate ID.
export const ANNOUNCEMENTS_API_BASE = '/api/v1/estate/announcements';

export const KIND_META: Record<AnnouncementKind, { label: string; icon: string; color: string; bg: string }> = {
  general:     { label: 'General',     icon: 'Megaphone',     color: Colors.primary,   bg: Colors.iconBgPurple },
  emergency:   { label: 'Emergency',   icon: 'Siren',         color: Colors.error,     bg: Colors.errorContainer },
  security:    { label: 'Security',    icon: 'ShieldAlert',   color: Colors.error,     bg: Colors.errorContainer },
  payment:     { label: 'Payment',     icon: 'CreditCard',    color: '#B26B00',        bg: 'rgba(245,158,11,0.12)' },
  maintenance: { label: 'Maintenance', icon: 'Wrench',        color: Colors.secondary, bg: Colors.iconBgBlue },
  meeting:     { label: 'Meeting',     icon: 'CalendarDays',  color: Colors.secondary, bg: Colors.iconBgBlue },
  election:    { label: 'Election',    icon: 'Vote',          color: Colors.primary,   bg: Colors.iconBgPurple },
};

const D = 86_400_000, iso = (o: number) => new Date(Date.now() + o).toISOString();
const items: Announcement[] = [
  { id: 'a1', estateId: 'est_amber_court', title: 'Water supply maintenance Saturday', body: 'The estate water supply will be interrupted 8am–12pm on Saturday for tank cleaning. Please store water in advance.', kind: 'maintenance', createdBy: 'res_2', createdByName: 'Estate Office', createdAt: iso(-0.2 * D), read: false },
  { id: 'a2', estateId: 'est_amber_court', title: 'Q3 service charge due 30th', body: 'Kindly settle the Q3 service charge before month end to keep your visitor and facility access active.', kind: 'payment', createdBy: 'res_2', createdByName: 'Estate Office', createdAt: iso(-1.5 * D), read: false },
  { id: 'a3', estateId: 'est_amber_court', title: 'Increased patrols this week', body: 'Following recent reports, security has increased night patrols. Report anything suspicious via the app.', kind: 'security', createdBy: 'res_3', createdByName: 'Security Committee', createdAt: iso(-3 * D), read: true },
];
const latency = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const idem = (k?: string) => ({ headers: { 'Idempotency-Key': k ?? generateIdempotencyKey() } });

// markRead and createAnnouncement have live route handlers, so fixture mode refuses
// loudly instead of reporting a notice posted or marked read that never reached the
// database — mirrors frontend-admin's crowdfundingAdminService.ts NOT_IN_FIXTURE_MODE pattern.
const notInFixtureMode = (action: string) =>
  new Error(`${action} is unavailable in fixture mode: this app will not report a write it did not perform. Set EXPO_PUBLIC_ANNOUNCEMENTS_USE_MOCK=false to send this against the live backend.`);

export async function listAnnouncements(): Promise<Announcement[]> {
  if (USE_MOCK) { await latency(); return items.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)); }
  const { data } = await api.get<Announcement[]>(ANNOUNCEMENTS_API_BASE); return data;
}
export async function getAnnouncement(id: string): Promise<Announcement> {
  if (USE_MOCK) { await latency(200); const a = items.find((x) => x.id === id); if (!a) throw new Error('Not found'); a.read = true; return { ...a }; }
  const { data } = await api.get<Announcement>(`${ANNOUNCEMENTS_API_BASE}/${id}`); return data;
}
export async function markRead(id: string): Promise<void> {
  if (USE_MOCK) throw notInFixtureMode('Marking an announcement read');
  await api.post(`${ANNOUNCEMENTS_API_BASE}/${id}/read`, {});
}
export async function createAnnouncement(input: CreateAnnouncementInput): Promise<Announcement> {
  if (USE_MOCK) throw notInFixtureMode('Posting an announcement');
  const { data } = await api.post<Announcement>(ANNOUNCEMENTS_API_BASE, input, idem(input.idempotencyKey)); return data;
}
