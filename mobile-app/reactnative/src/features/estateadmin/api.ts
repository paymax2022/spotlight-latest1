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
  const { data } = await api.get<AdminSummary>(`${ADMIN_API_BASE}/summary`); return data;
}

// Admin quick-actions → existing estate routes.
export interface AdminAction { id: string; label: string; icon: string; route: string; badgeKey?: keyof AdminSummary['attention'] }
export const ADMIN_ACTIONS: AdminAction[] = [
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
