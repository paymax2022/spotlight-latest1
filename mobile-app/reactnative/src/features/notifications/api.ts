// Estate Notifications center (Block 43) — types + dual mock/live api + constants.
import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';

export type NotificationCategory = 'general' | 'payment' | 'meeting' | 'election' | 'security' | 'maintenance' | 'facility' | 'announcement' | 'system';

export interface EstateNotification {
  id: string; estateId: string; category: NotificationCategory | string;
  title: string; body?: string; deepLink?: string; readAt?: string; createdAt: string;
}

export const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_NOTIFICATIONS_USE_MOCK, true);

// The in-app notification feed here is the Estate module's notification
// center (Block 43), served by the resident-scoped frontend-web handlers under
// /api/v1/estate/notifications (GET list, POST /{id}/read, POST /read-all).
// The current resident's estate is derived SERVER-SIDE from the auth token
// (frontend-web/src/server/estate/resident.ts → getResidentContext), so the
// client never passes an estate ID.
export const NOTIFICATIONS_API_BASE = '/api/v1/estate/notifications';

export const CATEGORY_META: Record<NotificationCategory, { label: string; icon: string }> = {
  general:      { label: 'General',      icon: 'Bell' },
  payment:      { label: 'Payment',      icon: 'ReceiptText' },
  meeting:      { label: 'Meeting',      icon: 'CalendarDays' },
  election:     { label: 'Election',     icon: 'Vote' },
  security:     { label: 'Security',     icon: 'ShieldAlert' },
  maintenance:  { label: 'Maintenance',  icon: 'Wrench' },
  facility:     { label: 'Facility',     icon: 'CalendarCheck' },
  announcement: { label: 'Announcement', icon: 'Megaphone' },
  system:       { label: 'System',       icon: 'Settings' },
};

const H = 3_600_000, iso = (o: number) => new Date(Date.now() + o).toISOString();
let items: EstateNotification[] = [
  { id: 'nt1', estateId: 'est_amber_court', category: 'payment', title: 'Service charge due in 7 days', body: '₦7,500 service charge is due. Pay from your wallet to avoid penalties.', deepLink: '/dues', createdAt: iso(-1 * H) },
  { id: 'nt2', estateId: 'est_amber_court', category: 'security', title: 'Security alert resolved', body: 'The reported loitering at Block A has been resolved by estate security.', deepLink: '/emergencies', readAt: iso(-3 * H), createdAt: iso(-4 * H) },
  { id: 'nt3', estateId: 'est_amber_court', category: 'meeting', title: 'Q3 General Meeting scheduled', body: 'Tap to RSVP for the upcoming general meeting.', deepLink: '/meetings', createdAt: iso(-26 * H) },
  { id: 'nt4', estateId: 'est_amber_court', category: 'announcement', title: 'Water supply maintenance', body: 'Water will be off between 9am–12pm on Saturday.', deepLink: '/announcements', readAt: iso(-40 * H), createdAt: iso(-48 * H) },
];
const latency = (ms = 300) => new Promise((r) => setTimeout(r, ms));

export async function listNotifications(): Promise<EstateNotification[]> {
  if (USE_MOCK) { await latency(); return items.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)); }
  const { data } = await api.get<EstateNotification[]>(NOTIFICATIONS_API_BASE); return data;
}
export async function markRead(id: string): Promise<void> {
  if (USE_MOCK) { await latency(120); const n = items.find((x) => x.id === id); if (n && !n.readAt) n.readAt = new Date().toISOString(); return; }
  await api.post(`${NOTIFICATIONS_API_BASE}/${id}/read`, {});
}
export async function markAllRead(): Promise<void> {
  if (USE_MOCK) { await latency(200); const now = new Date().toISOString(); items = items.map((n) => (n.readAt ? n : { ...n, readAt: now })); return; }
  await api.post(`${NOTIFICATIONS_API_BASE}/read-all`, {});
}
