// Estate Notifications center (Block 43) — types + dual mock/live api + constants.
// Phase 2.5a (estate-d EST-UAT-0359 / ESTD-D008) added the inbox halves: state, search, archive, pin
// and the estate's retention schedule.
import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';

export type NotificationCategory = 'general' | 'payment' | 'meeting' | 'election' | 'security' | 'maintenance' | 'facility' | 'announcement' | 'system';

export interface EstateNotification {
  id: string; estateId: string; category: NotificationCategory | string;
  title: string; body?: string; deepLink?: string; readAt?: string; createdAt: string;
  /** Set on the recipient's copy when they put it in the archive. Never a deletion. */
  archivedAt?: string;
  /** Must-not-sweep flag: the retention sweep leaves a pinned row out of both halves of its work. */
  pinned: boolean;
}

export type InboxState = 'active' | 'archived' | 'all';

export interface InboxParams {
  state?: InboxState;
  q?: string;
  category?: string;
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

// The envelope the feed answers with. `total` is how many rows match before paging, which is what turns
// "there are 214 older notices" from a guess into a number on the screen.
export interface NotificationPage {
  data: EstateNotification[];
  total: number;
  limit: number;
  offset: number;
  state: InboxState;
  unread_only: boolean;
}

export const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_NOTIFICATIONS_USE_MOCK, true);

// The in-app notification feed here is the Estate module's notification
// center (Block 43), served by the resident-scoped frontend-web handlers under
// /api/v1/estate/notifications (GET list, POST /{id}/read, POST /read-all,
// POST /{id}/archive, POST /{id}/pin, GET|PUT /retention, POST /retention/run).
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

// Categories the retention policy can protect from archiving, in the order the console lists them.
export const PROTECTABLE_CATEGORIES: NotificationCategory[] = [
  'payment', 'meeting', 'election', 'security', 'maintenance', 'facility', 'announcement', 'system',
];

const H = 3_600_000, iso = (o: number) => new Date(Date.now() + o).toISOString();
let items: EstateNotification[] = [
  { id: 'nt1', estateId: 'est_amber_court', category: 'payment', title: 'Service charge due in 7 days', body: '₦7,500 service charge is due. Pay from your wallet to avoid penalties.', deepLink: '/dues', createdAt: iso(-1 * H), pinned: false },
  { id: 'nt2', estateId: 'est_amber_court', category: 'security', title: 'Security alert resolved', body: 'The reported loitering at Block A has been resolved by estate security.', deepLink: '/emergencies', readAt: iso(-3 * H), createdAt: iso(-4 * H), pinned: false },
  { id: 'nt3', estateId: 'est_amber_court', category: 'meeting', title: 'Q3 General Meeting scheduled', body: 'Tap to RSVP for the upcoming general meeting.', deepLink: '/meetings', createdAt: iso(-26 * H), pinned: false },
  { id: 'nt4', estateId: 'est_amber_court', category: 'announcement', title: 'Water supply maintenance', body: 'Water will be off between 9am–12pm on Saturday.', deepLink: '/announcements', readAt: iso(-40 * H), createdAt: iso(-48 * H), pinned: false },
  { id: 'nt5', estateId: 'est_amber_court', category: 'payment', title: 'Last quarter’s dues receipt', body: 'Receipt for the ₦7,500 service charge paid last quarter.', deepLink: '/dues', readAt: iso(-700 * H), archivedAt: iso(-680 * H), createdAt: iso(-740 * H), pinned: false },
];
const latency = (ms = 300) => new Promise((r) => setTimeout(r, ms));

function emptyPage(state: InboxState, unreadOnly: boolean, limit: number, offset: number): NotificationPage {
  return { data: [], total: 0, limit, offset, state, unread_only: unreadOnly };
}

export async function listNotifications(params: InboxParams = {}): Promise<NotificationPage> {
  const state = params.state ?? 'active';
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const unreadOnly = !!params.unreadOnly;
  if (USE_MOCK) {
    await latency();
    const term = (params.q ?? '').trim().toLowerCase();
    let rows = items.filter((n) => (state === 'all' ? true : state === 'archived' ? !!n.archivedAt : !n.archivedAt));
    if (unreadOnly) rows = rows.filter((n) => !n.readAt);
    if (params.category) rows = rows.filter((n) => n.category === params.category);
    if (term) rows = rows.filter((n) => `${n.title} ${n.body ?? ''}`.toLowerCase().includes(term));
    const total = rows.length;
    const data = rows
      .slice()
      .sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (+new Date(b.createdAt) - +new Date(a.createdAt)))
      .slice(offset, offset + limit);
    return { data, total, limit, offset, state, unread_only: unreadOnly };
  }
  const { data } = await api.get<NotificationPage>(NOTIFICATIONS_API_BASE, {
    params: {
      state, ...(params.q ? { q: params.q } : {}), ...(params.category ? { category: params.category } : {}),
      ...(unreadOnly ? { unread_only: 'true' } : {}), limit, ...(offset ? { offset } : {}),
    },
  });
  return data ?? emptyPage(state, unreadOnly, limit, offset);
}

export async function markRead(id: string): Promise<void> {
  if (USE_MOCK) { await latency(120); const n = items.find((x) => x.id === id); if (n && !n.readAt) n.readAt = new Date().toISOString(); return; }
  await api.post(`${NOTIFICATIONS_API_BASE}/${id}/read`, {});
}
export async function markAllRead(): Promise<void> {
  if (USE_MOCK) { await latency(200); const now = new Date().toISOString(); items = items.map((n) => (n.readAt || n.archivedAt ? n : { ...n, readAt: now })); return; }
  await api.post(`${NOTIFICATIONS_API_BASE}/read-all`, {});
}

/** Move one notice between the inbox and the archive. Reversible, and only ever the caller's own copy. */
export async function setArchived(id: string, archived: boolean): Promise<void> {
  if (USE_MOCK) {
    await latency(120);
    items = items.map((n) => n.id === id ? { ...n, archivedAt: archived ? new Date().toISOString() : undefined } : n);
    return;
  }
  await api.post(`${NOTIFICATIONS_API_BASE}/${id}/archive`, { archived });
}

/** Mark one notice must-not-sweep. An estate admin may pin a member's copy; the route decides that. */
export async function setPinned(id: string, pinned: boolean): Promise<void> {
  if (USE_MOCK) { await latency(120); items = items.map((n) => (n.id === id ? { ...n, pinned } : n)); return; }
  await api.post(`${NOTIFICATIONS_API_BASE}/${id}/pin`, { pinned });
}

// ---- Estate retention schedule (admin plane) ----

export interface RetentionPolicy {
  estate_id: string;
  enabled: boolean;
  archive_after_days: number;
  /** null means "never purge". Purging is opt-in because it is the one action here that cannot be undone. */
  purge_after_days: number | null;
  keep_categories: string[];
  /** true while the estate has never written a policy: these are the defaults, not somebody's decision. */
  defaulted: boolean;
  updated_by?: string;
  updated_at?: string;
}

export type RetentionPolicyPatch = Partial<Pick<RetentionPolicy, 'enabled' | 'archive_after_days' | 'purge_after_days' | 'keep_categories'>>;

export interface RetentionRunResult {
  estate_id?: string;
  notifications_archived: number;
  notifications_purged: number;
}

const MOCK_POLICY: RetentionPolicy = {
  estate_id: 'est_amber_court', enabled: true, archive_after_days: 90, purge_after_days: null,
  keep_categories: ['security', 'system'], defaulted: true,
};

export async function getRetentionPolicy(): Promise<RetentionPolicy> {
  if (USE_MOCK) { await latency(); return { ...MOCK_POLICY }; }
  const { data } = await api.get<RetentionPolicy>(`${NOTIFICATIONS_API_BASE}/retention`);
  return data;
}

export async function setRetentionPolicy(patch: RetentionPolicyPatch): Promise<RetentionPolicy> {
  if (USE_MOCK) { await latency(200); return { ...MOCK_POLICY, ...patch, defaulted: false }; }
  const { data } = await api.put<RetentionPolicy>(`${NOTIFICATIONS_API_BASE}/retention`, patch);
  return data;
}

export async function runRetention(): Promise<RetentionRunResult> {
  if (USE_MOCK) { await latency(400); return { notifications_archived: 0, notifications_purged: 0 }; }
  const { data } = await api.post<RetentionRunResult>(`${NOTIFICATIONS_API_BASE}/retention/run`, {});
  return data;
}
