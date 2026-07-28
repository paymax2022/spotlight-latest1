// Estate Admin panel (Block 41) — types + dual mock/live api.
import { api } from '@/api/client';

export interface AdminSummary {
  residents: number;
  properties: number;
  attention: {
    pendingJoinRequests: number;
    openEmergencies: number;
    openRepairs: number;
    pendingInvoices: number;
    pendingBookings: number;
  };
  upcomingMeetings: number;
}

export const USE_MOCK = (process.env.EXPO_PUBLIC_ESTATEADMIN_USE_MOCK ?? 'true') !== 'false';
// Only GET /api/v1/estate/admin/summary exists as a Next.js route today
// (frontend-web/app/api/v1/estate/admin/summary/route.ts). There is NO Next.js
// route (and no blanket rewrite — /api/finance/:path* does not cover
// /api/v1/estate/admin/*) for /dashboard, /residents, /residents/:id/ban,
// /residents/:id/restore, /config, /rules, /subscription-plan, /audit-log or
// /run-maintenance, even though the Go estate module implements all of them at
// /api/finance/estate/:id/admin/*. Everything below getAdminSummary() stays
// mock-only until those proxy routes are added (see MISSING endpoints in the
// go-live report) — flipping USE_MOCK=false today would only make summary live.
export const ADMIN_API_BASE = '/api/v1/estate/admin';

const mock: AdminSummary = {
  residents: 86,
  properties: 64,
  attention: { pendingJoinRequests: 3, openEmergencies: 1, openRepairs: 4, pendingInvoices: 9, pendingBookings: 2 },
  upcomingMeetings: 2,
};
const latency = (ms = 300) => new Promise((r) => setTimeout(r, ms));

export async function getAdminSummary(): Promise<AdminSummary> {
  if (USE_MOCK) { await latency(); return JSON.parse(JSON.stringify(mock)); }
  // Live: GET /api/v1/estate/admin/summary — camelCase envelope
  // { residents, properties, attention: {...}, upcomingMeetings } (see
  // frontend-web/app/api/v1/estate/admin/summary/route.ts). This route exists;
  // /dashboard does not (that shape belonged to the Go handler, unreachable from
  // mobile today).
  const { data } = await api.get(`${ADMIN_API_BASE}/summary`);
  return {
    residents: Number(data.residents ?? 0),
    properties: Number(data.properties ?? 0),
    attention: {
      pendingJoinRequests: Number(data.attention?.pendingJoinRequests ?? 0),
      openEmergencies: Number(data.attention?.openEmergencies ?? 0),
      openRepairs: Number(data.attention?.openRepairs ?? 0),
      pendingInvoices: Number(data.attention?.pendingInvoices ?? 0),
      pendingBookings: Number(data.attention?.pendingBookings ?? 0),
    },
    upcomingMeetings: Number(data.upcomingMeetings ?? 0),
  };
}

// ── Block 41 admin management ─────────────────────────────────────────────────
export interface AdminResident { id: string; userId: string; unit: string; role: string; banned: boolean; deleted: boolean; createdAt: string; }
export interface EstateConfig { estateId: string; rules: Record<string, unknown>; subscriptionPlan: Record<string, unknown>; }
export interface AuditEntry { id: string; actorId?: string | null; action: string; subjectType: string; subjectId: string; createdAt: string; }

export async function listResidents(role?: string): Promise<AdminResident[]> {
  if (USE_MOCK) { await latency(); return []; }
  const res = await api.get(`${ADMIN_API_BASE}/residents`, { params: role ? { role } : undefined });
  const rows = (res.data?.data ?? res.data ?? []) as any[];
  return rows.map((r) => ({ id: r.id, userId: r.user_id, unit: r.unit ?? '', role: r.role, banned: !!r.banned, deleted: !!r.deleted, createdAt: r.created_at }));
}
export async function banResident(userId: string, reason?: string): Promise<void> {
  if (USE_MOCK) { await latency(); return; }
  await api.post(`${ADMIN_API_BASE}/residents/${userId}/ban`, { reason });
}
export async function restoreResident(userId: string): Promise<void> {
  if (USE_MOCK) { await latency(); return; }
  await api.post(`${ADMIN_API_BASE}/residents/${userId}/restore`);
}
export async function getEstateConfig(): Promise<EstateConfig> {
  if (USE_MOCK) { await latency(); return { estateId: 'est_amber_court', rules: {}, subscriptionPlan: {} }; }
  const { data } = await api.get(`${ADMIN_API_BASE}/config`);
  return { estateId: data.estate_id, rules: data.rules ?? {}, subscriptionPlan: data.subscription_plan ?? {} };
}
export async function setEstateRules(rules: Record<string, unknown>): Promise<void> {
  if (USE_MOCK) { await latency(); return; }
  await api.put(`${ADMIN_API_BASE}/rules`, rules);
}
export async function setSubscriptionPlan(plan: Record<string, unknown>): Promise<void> {
  if (USE_MOCK) { await latency(); return; }
  await api.put(`${ADMIN_API_BASE}/subscription-plan`, plan);
}
export async function getAuditLog(limit = 50, offset = 0): Promise<AuditEntry[]> {
  if (USE_MOCK) { await latency(); return []; }
  const res = await api.get(`${ADMIN_API_BASE}/audit-log`, { params: { limit, offset } });
  const rows = (res.data?.data ?? res.data ?? []) as any[];
  return rows.map((r) => ({ id: r.id, actorId: r.actor_id ?? null, action: r.action, subjectType: r.subject_type ?? '', subjectId: r.subject_id ?? '', createdAt: r.created_at }));
}
export async function runMaintenance(): Promise<Record<string, number>> {
  if (USE_MOCK) { await latency(); return { invoices_marked_overdue: 0, restrictions_applied: 0, access_codes_expired: 0 }; }
  const { data } = await api.post(`${ADMIN_API_BASE}/run-maintenance`);
  return (data?.data ?? data ?? {}) as Record<string, number>;
}

// Admin quick-actions → existing estate routes.
export interface AdminAction { id: string; label: string; icon: string; route: string; badgeKey?: keyof AdminSummary['attention'] }
export const ADMIN_ACTIONS: AdminAction[] = [
  { id: 'residents',     label: 'Residents',      icon: 'Users',        route: '/estate-admin/residents' },
  { id: 'finance',       label: 'Finance',        icon: 'LineChart',    route: '/finance' },
  { id: 'properties',    label: 'Properties',     icon: 'Building2',     route: '/properties' },
  { id: 'announce',      label: 'Post notice',    icon: 'Megaphone',    route: '/announcements/create' },
  { id: 'meeting',       label: 'New meeting',    icon: 'CalendarPlus', route: '/meetings/create' },
  { id: 'repairs',       label: 'Maintenance',    icon: 'Wrench',       route: '/repairs', badgeKey: 'openRepairs' },
  { id: 'emergencies',   label: 'Emergencies',    icon: 'Siren',        route: '/emergencies', badgeKey: 'openEmergencies' },
  { id: 'dues',          label: 'Dues',           icon: 'ReceiptText',  route: '/dues', badgeKey: 'pendingInvoices' },
  { id: 'facilities',    label: 'Bookings',       icon: 'CalendarCheck',route: '/facilities', badgeKey: 'pendingBookings' },
  { id: 'reports',       label: 'Reports',        icon: 'FileBarChart', route: '/reports' },
  { id: 'documents',     label: 'Documents',      icon: 'FolderOpen',   route: '/documents' },
  { id: 'ai',            label: 'AI notes',       icon: 'Sparkles',     route: '/ai-notes' },
  { id: 'vendors',       label: 'Vendors',        icon: 'Hammer',       route: '/vendors' },
];
