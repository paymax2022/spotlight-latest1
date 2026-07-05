// ── Admin — Estate control-plane service ─────────────────────────────────────
// Mock by default (mirrors realtorAdminService / investAdminService). Flip with
// NEXT_PUBLIC_ESTATE_ADMIN_USE_MOCK=false to hit the live Go backend endpoints.
// All money is integer minor units (kobo).
//
// Live endpoints (canonical, served by the Go backend under /api/finance):
//   GET  /api/finance/estate/:id/admin/dashboard
//   GET  /api/finance/estate/:id/admin/residents
//   GET  /api/finance/estate/:id/dues/invoices
//   GET  /api/finance/estate/:id/gates
//   GET  /api/finance/estate/:id/guard/incidents
//   GET  /api/finance/estate/:id/vendors
//   GET  /api/finance/property/context
//   GET  /api/finance/property/rent-passport/lookup/:userId  (perm: property.manage)

import { env } from '@/config/env';
import type {
  EstateKpis, EstateActivity, AdminResident, AdminDuesInvoice,
  AdminGate, AdminGuardShift, AdminIncident, AdminVendor,
  RentPassport, PropertyContext, ResidentStatus, VendorStatus,
} from '@/types/estateAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_ESTATE_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

// The canonical Go backend mounts finance verticals under /api/finance, while
// env.apiBaseUrl ends with /api/v1. Strip the version suffix and target /api/finance.
function financeBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/finance');
}
// Active estate is resolved server-side from membership; the admin console pins
// the demo estate id. Override with NEXT_PUBLIC_ESTATE_ADMIN_ESTATE_ID.
function estateId(): string {
  return process.env.NEXT_PUBLIC_ESTATE_ADMIN_ESTATE_ID || 'demo-estate';
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${financeBase()}${path}`, { headers: authHeaders(), cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return (body?.data ?? body) as T;
}
async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(`${financeBase()}${path}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return (body?.data ?? body) as T;
}

const hrs = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();
const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

// ─── Mock datasets ────────────────────────────────────────────────────────────
const KPIS: EstateKpis = {
  residents: 318, units: 240,
  collectionsThisCycleKobo: 41_200_000_00, expectedThisCycleKobo: 58_000_000_00,
  openIncidents: 4, activeVendors: 27, arrearsKobo: 16_800_000_00,
};

const ACTIVITY: EstateActivity[] = [
  { id: 'a1', kind: 'payment', summary: 'Q2 service charge paid — Block B · Flat 4', actor: 'Ngozi Umeh', at: hrs(1) },
  { id: 'a2', kind: 'incident', summary: 'Gate intrusion alert raised at North Gate', actor: 'Guard: M. Sani', at: hrs(3) },
  { id: 'a3', kind: 'vendor', summary: 'New vendor application — RapidFix Plumbing', actor: 'System', at: hrs(6) },
  { id: 'a4', kind: 'resident', summary: 'Tenant onboarded — Block C · Flat 11', actor: 'Estate Admin', at: hrs(20) },
  { id: 'a5', kind: 'gate', summary: 'Main Gate barrier back online', actor: 'System', at: days(1) },
];

let RESIDENTS: AdminResident[] = [
  { id: 'r1', name: 'Ngozi Umeh', unit: 'Block B · Flat 4', role: 'owner', phone: '0803 111 2222', status: 'active', arrearsKobo: 0, joinedAt: days(420) },
  { id: 'r2', name: 'Tunde Bakare', unit: 'Block A · Flat 9', role: 'tenant', phone: '0805 333 4444', status: 'active', arrearsKobo: 1_800_000_00, joinedAt: days(180) },
  { id: 'r3', name: 'Aisha Bello', unit: 'Block C · Flat 11', role: 'tenant', phone: '0807 555 6666', status: 'active', arrearsKobo: 0, joinedAt: days(30) },
  { id: 'r4', name: 'Chidi Eze', unit: 'Block A · Flat 2', role: 'owner', phone: '0809 777 8888', status: 'banned', arrearsKobo: 4_200_000_00, joinedAt: days(700) },
  { id: 'r5', name: 'Funmi Adeyemi', unit: 'Block D · Flat 7', role: 'tenant', phone: '0802 999 0000', status: 'active', arrearsKobo: 600_000_00, joinedAt: days(95) },
];

const INVOICES: AdminDuesInvoice[] = [
  { id: 'i1', reference: 'EST-Q2-0041', unit: 'Block B · Flat 4', residentName: 'Ngozi Umeh', description: 'Q2 Service charge', amountKobo: 4_500_000_00, paidKobo: 4_500_000_00, status: 'paid', dueAt: days(-5), restricted: false },
  { id: 'i2', reference: 'EST-Q2-0042', unit: 'Block A · Flat 9', residentName: 'Tunde Bakare', description: 'Q2 Service charge', amountKobo: 4_500_000_00, paidKobo: 2_700_000_00, status: 'pending', dueAt: days(-2), restricted: false },
  { id: 'i3', reference: 'EST-Q2-0019', unit: 'Block A · Flat 2', residentName: 'Chidi Eze', description: 'Q1 + Q2 arrears', amountKobo: 9_000_000_00, paidKobo: 4_800_000_00, status: 'overdue', dueAt: days(20), restricted: false },
  { id: 'i4', reference: 'EST-SEC-0007', unit: 'Block D · Flat 7', residentName: 'Funmi Adeyemi', description: 'Security levy', amountKobo: 600_000_00, paidKobo: 0, status: 'restricted', dueAt: days(40), restricted: true },
];

const GATES: AdminGate[] = [
  { id: 'g1', name: 'Main Gate', location: 'Estate entrance', status: 'online', guardsOnDuty: 2, lastHeartbeat: hrs(0.1) },
  { id: 'g2', name: 'North Gate', location: 'Block C side road', status: 'online', guardsOnDuty: 1, lastHeartbeat: hrs(0.2) },
  { id: 'g3', name: 'Service Gate', location: 'Rear / deliveries', status: 'maintenance', guardsOnDuty: 0, lastHeartbeat: hrs(5) },
];

const SHIFTS: AdminGuardShift[] = [
  { id: 's1', guardName: 'Musa Sani', gate: 'Main Gate', shift: 'day', startsAt: hrs(3), endsAt: hrs(-9), status: 'on_duty' },
  { id: 's2', guardName: 'Peter Obi', gate: 'North Gate', shift: 'day', startsAt: hrs(3), endsAt: hrs(-9), status: 'on_duty' },
  { id: 's3', guardName: 'Emeka Nwosu', gate: 'Main Gate', shift: 'night', startsAt: hrs(-9), endsAt: hrs(-21), status: 'scheduled' },
  { id: 's4', guardName: 'Bala Yusuf', gate: 'Service Gate', shift: 'day', startsAt: days(1), endsAt: days(1), status: 'missed' },
];

const INCIDENTS: AdminIncident[] = [
  { id: 'inc1', title: 'Unauthorised entry attempt', gate: 'North Gate', severity: 'high', status: 'investigating', reportedBy: 'Musa Sani', reportedAt: hrs(3) },
  { id: 'inc2', title: 'Visitor refused to log out', gate: 'Main Gate', severity: 'low', status: 'resolved', reportedBy: 'Peter Obi', reportedAt: hrs(28) },
  { id: 'inc3', title: 'Barrier malfunction', gate: 'Service Gate', severity: 'medium', status: 'open', reportedBy: 'System', reportedAt: hrs(6) },
  { id: 'inc4', title: 'Power outage on perimeter CCTV', gate: 'North Gate', severity: 'critical', status: 'open', reportedBy: 'Facilities', reportedAt: hrs(2) },
];

let VENDORS: AdminVendor[] = [
  { id: 'v1', name: 'BrightSpark Electricals', trade: 'Electrician', phone: '0810 222 3333', rating: 4.7, jobsCompleted: 84, status: 'verified', submittedAt: days(220) },
  { id: 'v2', name: 'RapidFix Plumbing', trade: 'Plumber', phone: '0811 444 5555', rating: 0, jobsCompleted: 0, status: 'pending', submittedAt: hrs(6) },
  { id: 'v3', name: 'GreenScape Gardens', trade: 'Landscaping', phone: '0812 666 7777', rating: 4.3, jobsCompleted: 41, status: 'verified', submittedAt: days(150) },
  { id: 'v4', name: 'CoolAir HVAC', trade: 'AC technician', phone: '0813 888 9999', rating: 2.1, jobsCompleted: 12, status: 'suspended', submittedAt: days(80) },
];

const RENT_PASSPORT: RentPassport = {
  userId: '', displayName: 'Tunde Bakare', score: 742,
  onTimePaymentRatePct: 91, tenanciesCompleted: 3, activeTenancies: 1,
  totalRentPaidKobo: 18_400_000_00, arrearsKobo: 1_800_000_00,
  verifiedIdentity: true, issuedAt: new Date().toISOString(),
};

const CONTEXT: PropertyContext = {
  userId: 'admin-demo', activeRole: 'estate_admin',
  availableRoles: ['estate_admin', 'owner', 'tenant'],
  estateId: 'demo-estate',
  permissions: ['estate.manage', 'estate.admin', 'property.manage'],
};

// ─── API ──────────────────────────────────────────────────────────────────────
export async function getEstateKpis(): Promise<EstateKpis> {
  if (USE_MOCK) { await delay(); return { ...KPIS }; }
  return getJson<EstateKpis>(`/estate/${estateId()}/admin/dashboard`);
}

export async function getEstateActivity(): Promise<EstateActivity[]> {
  if (USE_MOCK) { await delay(); return [...ACTIVITY]; }
  return getJson<EstateActivity[]>(`/estate/${estateId()}/admin/dashboard/activity`);
}

export async function listResidents(): Promise<AdminResident[]> {
  if (USE_MOCK) { await delay(); return [...RESIDENTS]; }
  return getJson<AdminResident[]>(`/estate/${estateId()}/admin/residents`);
}

export async function banResident(id: string): Promise<{ id: string; status: ResidentStatus }> {
  if (USE_MOCK) { await delay(280); RESIDENTS = RESIDENTS.map((r) => (r.id === id ? { ...r, status: 'banned' } : r)); return { id, status: 'banned' }; }
  return postJson<{ id: string; status: ResidentStatus }>(`/estate/${estateId()}/admin/residents/${id}/ban`, {});
}

export async function restoreResident(id: string): Promise<{ id: string; status: ResidentStatus }> {
  if (USE_MOCK) { await delay(280); RESIDENTS = RESIDENTS.map((r) => (r.id === id ? { ...r, status: 'active' } : r)); return { id, status: 'active' }; }
  return postJson<{ id: string; status: ResidentStatus }>(`/estate/${estateId()}/admin/residents/${id}/restore`, {});
}

export async function listDuesInvoices(): Promise<AdminDuesInvoice[]> {
  if (USE_MOCK) { await delay(); return [...INVOICES]; }
  return getJson<AdminDuesInvoice[]>(`/estate/${estateId()}/dues/invoices`);
}

export async function listGates(): Promise<AdminGate[]> {
  if (USE_MOCK) { await delay(); return [...GATES]; }
  return getJson<AdminGate[]>(`/estate/${estateId()}/gates`);
}

export async function listGuardShifts(): Promise<AdminGuardShift[]> {
  if (USE_MOCK) { await delay(); return [...SHIFTS]; }
  return getJson<AdminGuardShift[]>(`/estate/${estateId()}/guard/shifts`);
}

export async function listIncidents(): Promise<AdminIncident[]> {
  if (USE_MOCK) { await delay(); return [...INCIDENTS]; }
  return getJson<AdminIncident[]>(`/estate/${estateId()}/guard/incidents`);
}

export async function listVendors(): Promise<AdminVendor[]> {
  if (USE_MOCK) { await delay(); return [...VENDORS]; }
  return getJson<AdminVendor[]>(`/estate/${estateId()}/vendors`);
}

export async function verifyVendor(id: string): Promise<{ id: string; status: VendorStatus }> {
  if (USE_MOCK) { await delay(280); VENDORS = VENDORS.map((v) => (v.id === id ? { ...v, status: 'verified' } : v)); return { id, status: 'verified' }; }
  return postJson<{ id: string; status: VendorStatus }>(`/estate/${estateId()}/vendors/${id}/verify`, {});
}

export async function getRentPassport(userId: string): Promise<RentPassport> {
  if (USE_MOCK) { await delay(); return { ...RENT_PASSPORT, userId }; }
  return getJson<RentPassport>(`/property/rent-passport/lookup/${userId}`);
}

export async function getPropertyContext(): Promise<PropertyContext> {
  if (USE_MOCK) { await delay(); return { ...CONTEXT }; }
  return getJson<PropertyContext>('/property/context');
}
