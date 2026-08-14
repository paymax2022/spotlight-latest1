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
  OversightIncident, OversightGuardShift, OversightVisitorLog, OversightEmergency,
  DuesReconciliationRow, OversightPayment, OversightRestriction,
  OversightRepair, OversightTask, OversightMeeting, OversightFacility,
  OversightAnnouncement, OversightDocument,
  OversightElection, ElectionResultRow, ElectionAudit,
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

// ─── Platform estate oversight (backend /api/finance/estate-admin/*) ──────────
// Read-only cross-estate oversight. The Go backend returns snake_case rows under
// {data:[...]}; getJson already unwraps {data}. We map snake→camel here so the
// admin console types stay camelCase. Optional `estateId` scopes to one estate.

function toCamel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const ck = k.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
    out[ck] = v;
  }
  return out as T;
}

function qs(estateId?: string, extra?: Record<string, string>): string {
  const p = new URLSearchParams();
  if (estateId) p.set('estate_id', estateId);
  for (const [k, v] of Object.entries(extra ?? {})) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function getRows<T>(path: string): Promise<T[]> {
  const rows = await getJson<Array<Record<string, unknown>>>(path);
  return (rows ?? []).map((r) => toCamel<T>(r));
}

// Mock datasets for the oversight surfaces (mirror the live row shapes) ────────
const O_INCIDENTS: OversightIncident[] = [
  { id: 'oi1', estateId: 'demo-estate', guardId: 'guard-01', gateId: 'g2', incidentType: 'trespassing', description: 'Unauthorised entry attempt at North Gate', evidenceUrl: null, escalated: true, createdAt: hrs(3) },
  { id: 'oi2', estateId: 'demo-estate', guardId: 'guard-02', gateId: 'g1', incidentType: 'suspicious', description: 'Loitering near Block A car park', evidenceUrl: null, escalated: false, createdAt: hrs(9) },
  { id: 'oi3', estateId: 'estate-2', guardId: 'guard-07', gateId: null, incidentType: 'vehicle', description: 'Blocked service lane', evidenceUrl: null, escalated: false, createdAt: days(1) },
];
const O_SHIFTS: OversightGuardShift[] = [
  { id: 'os1', estateId: 'demo-estate', guardId: 'guard-01', gateId: 'g1', startedAt: hrs(3), endedAt: null, relievedBy: null, handoverNotes: null, onDuty: true },
  { id: 'os2', estateId: 'demo-estate', guardId: 'guard-02', gateId: 'g2', startedAt: hrs(3), endedAt: null, relievedBy: null, handoverNotes: null, onDuty: true },
  { id: 'os3', estateId: 'demo-estate', guardId: 'guard-03', gateId: 'g1', startedAt: hrs(15), endedAt: hrs(3), relievedBy: 'guard-01', handoverNotes: 'Quiet night; barrier serviced', onDuty: false },
];
const O_VISITOR_LOGS: OversightVisitorLog[] = [
  { id: 'ov1', estateId: 'demo-estate', guardId: 'guard-01', eventType: 'checkin', payload: { code: 'A1B2', visitor: 'Courier — DHL' }, capturedAt: hrs(1), syncedAt: hrs(0.9) },
  { id: 'ov2', estateId: 'demo-estate', guardId: 'guard-01', eventType: 'checkout', payload: { code: 'A1B2' }, capturedAt: hrs(0.5), syncedAt: hrs(0.4) },
  { id: 'ov3', estateId: 'demo-estate', guardId: 'guard-02', eventType: 'vehicle', payload: { plate: 'LND-238-KJA' }, capturedAt: hrs(4), syncedAt: hrs(3.8) },
];
const O_EMERGENCIES: OversightEmergency[] = [
  { id: 'oe1', estateId: 'demo-estate', reporterId: 'res-04', kind: 'security', description: 'Suspicious persons at perimeter', location: 'Block C rear', status: 'responding', createdAt: hrs(2) },
  { id: 'oe2', estateId: 'estate-2', reporterId: 'res-19', kind: 'medical', description: 'Resident collapse', location: 'Block A · Flat 3', status: 'resolved', createdAt: days(1) },
];
const O_RECON: DuesReconciliationRow[] = [
  { estateId: 'demo-estate', billedKobo: 58_000_000_00, collectedKobo: 41_200_000_00, paidInvoiceKobo: 41_200_000_00, outstandingKobo: 16_800_000_00, overdueCount: 6, varianceKobo: 0 },
  { estateId: 'estate-2', billedKobo: 22_500_000_00, collectedKobo: 19_100_000_00, paidInvoiceKobo: 18_900_000_00, outstandingKobo: 3_400_000_00, overdueCount: 2, varianceKobo: 200_000_00 },
];
const O_PAYMENTS: OversightPayment[] = [
  { id: 'op1', estateId: 'demo-estate', invoiceId: 'i1', payerId: 'res-01', amountKobo: 4_500_000_00, method: 'wallet', status: 'successful', reference: 'idem-9f21', createdAt: hrs(1) },
  { id: 'op2', estateId: 'demo-estate', invoiceId: 'i2', payerId: 'res-02', amountKobo: 2_700_000_00, method: 'transfer', status: 'successful', reference: 'idem-3a77', createdAt: hrs(20) },
  { id: 'op3', estateId: 'estate-2', invoiceId: null, payerId: 'res-19', amountKobo: 600_000_00, method: 'card', status: 'refunded', reference: 'idem-1c02', createdAt: days(2) },
];
const O_RESTRICTIONS: OversightRestriction[] = [
  { id: 'or1', estateId: 'demo-estate', residentId: 'res-04', invoiceId: 'i4', level: 'hard', reason: 'Security levy unpaid > 60 days', active: true, appliedBy: 'estate-admin', liftedAt: null, createdAt: days(5) },
  { id: 'or2', estateId: 'demo-estate', residentId: 'res-05', invoiceId: 'i3', level: 'soft', reason: 'Q2 arrears', active: false, appliedBy: 'estate-admin', liftedAt: days(1), createdAt: days(12) },
];
const O_REPAIRS: OversightRepair[] = [
  { id: 'orp1', estateId: 'demo-estate', propertyId: null, reporterId: 'res-03', category: 'generator', description: 'Estate generator overheating', urgency: 'high', status: 'assigned', vendorId: 'v1', costEstimateKobo: 850_000_00, createdAt: hrs(5) },
  { id: 'orp2', estateId: 'demo-estate', propertyId: null, reporterId: 'res-07', category: 'gate', description: 'Service gate barrier stuck', urgency: 'medium', status: 'in_progress', vendorId: null, costEstimateKobo: null, createdAt: hrs(30) },
  { id: 'orp3', estateId: 'estate-2', propertyId: null, reporterId: 'res-22', category: 'water', description: 'Borehole pump failure', urgency: 'high', status: 'reported', vendorId: null, costEstimateKobo: null, createdAt: days(1) },
];
const O_TASKS: OversightTask[] = [
  { id: 'ot1', estateId: 'demo-estate', title: 'Quarterly fire-drill', description: 'Coordinate with facilities', assigneeId: 'staff-01', createdBy: 'estate-admin', dueDate: days(-7), priority: 'high', status: 'in_progress', createdAt: days(3) },
  { id: 'ot2', estateId: 'demo-estate', title: 'Audit CCTV coverage', description: null, assigneeId: null, createdBy: 'estate-admin', dueDate: days(-14), priority: 'medium', status: 'todo', createdAt: days(2) },
];
const O_MEETINGS: OversightMeeting[] = [
  { id: 'om1', estateId: 'demo-estate', title: 'Q2 Residents AGM', agenda: 'Budget, security levy, elections', mode: 'hybrid', location: 'Clubhouse', startsAt: days(-3), endsAt: null, status: 'scheduled', createdBy: 'estate-admin', createdAt: days(10) },
  { id: 'om2', estateId: 'demo-estate', title: 'Security committee', agenda: 'Gate incidents review', mode: 'virtual', location: null, startsAt: days(2), endsAt: days(2), status: 'ended', createdBy: 'estate-admin', createdAt: days(5) },
];
const O_FACILITIES: OversightFacility[] = [
  { id: 'of1', estateId: 'demo-estate', name: 'Clubhouse Hall', kind: 'hall', capacity: 200, feeKobo: 5_000_000_00, createdAt: days(300) },
  { id: 'of2', estateId: 'demo-estate', name: 'Swimming Pool', kind: 'pool', capacity: 40, feeKobo: 0, createdAt: days(300) },
  { id: 'of3', estateId: 'demo-estate', name: 'Tennis Court', kind: 'court', capacity: 8, feeKobo: 1_000_000_00, createdAt: days(300) },
];
const O_ANNOUNCEMENTS: OversightAnnouncement[] = [
  { id: 'oa1', estateId: 'demo-estate', title: 'Water supply interruption', body: 'Mains maintenance Saturday 6-10am.', kind: 'maintenance', createdBy: 'estate-admin', createdAt: hrs(8) },
  { id: 'oa2', estateId: 'demo-estate', title: 'AGM nominations open', body: 'Submit candidacy by Friday.', kind: 'election', createdBy: 'estate-admin', createdAt: days(2) },
];
const O_DOCUMENTS: OversightDocument[] = [
  { id: 'od1', estateId: 'demo-estate', title: 'Estate bylaws 2026', category: 'governance', fileUrl: 'https://r2.example/bylaws.pdf', uploadedBy: 'estate-admin', restricted: false, createdAt: days(60) },
  { id: 'od2', estateId: 'demo-estate', title: 'Q1 financial statement', category: 'finance', fileUrl: 'https://r2.example/q1.pdf', uploadedBy: 'estate-admin', restricted: true, createdAt: days(20) },
];
const O_ELECTIONS: OversightElection[] = [
  { id: 'el1', estateId: 'demo-estate', title: 'Estate Chairman 2026', description: 'Two-year term', startsAt: days(2), endsAt: days(-5), status: 'open', createdBy: 'estate-admin', createdAt: days(14) },
  { id: 'el2', estateId: 'demo-estate', title: 'Security Committee Lead', description: null, startsAt: days(30), endsAt: days(23), status: 'tallied', createdBy: 'estate-admin', createdAt: days(45) },
];
const O_RESULTS: Record<string, ElectionResultRow[]> = {
  el1: [
    { candidateId: 'c1', name: 'Ngozi Umeh', bio: 'Incumbent vice-chair', votes: 142 },
    { candidateId: 'c2', name: 'Tunde Bakare', bio: 'Facilities lead', votes: 118 },
  ],
  el2: [
    { candidateId: 'c3', name: 'Musa Sani', bio: 'Head of security', votes: 96 },
    { candidateId: 'c4', name: 'Aisha Bello', bio: 'Neighbourhood watch', votes: 88 },
  ],
};
const O_AUDIT: Record<string, ElectionAudit> = {
  el1: { electionId: 'el1', ballotsCast: 260, distinctVoters: 260, candidates: 2, status: 'open', doubleVoteDetected: false },
  el2: { electionId: 'el2', ballotsCast: 184, distinctVoters: 184, candidates: 2, status: 'tallied', doubleVoteDetected: false },
};

// Security & guard oversight ----------------------------------------------------
export async function listOversightIncidents(estateId?: string): Promise<OversightIncident[]> {
  if (USE_MOCK) { await delay(); return O_INCIDENTS.filter((r) => !estateId || r.estateId === estateId); }
  return getRows<OversightIncident>(`/estate-admin/security/incidents${qs(estateId)}`);
}
export async function listOversightGuardShifts(estateId?: string, activeOnly = false): Promise<OversightGuardShift[]> {
  if (USE_MOCK) { await delay(); return O_SHIFTS.filter((r) => (!estateId || r.estateId === estateId) && (!activeOnly || r.onDuty)); }
  return getRows<OversightGuardShift>(`/estate-admin/security/guard-shifts${qs(estateId, activeOnly ? { active: 'true' } : undefined)}`);
}
export async function listOversightVisitorLogs(estateId?: string): Promise<OversightVisitorLog[]> {
  if (USE_MOCK) { await delay(); return O_VISITOR_LOGS.filter((r) => !estateId || r.estateId === estateId); }
  return getRows<OversightVisitorLog>(`/estate-admin/security/visitor-logs${qs(estateId)}`);
}
export async function listOversightEmergencies(estateId?: string): Promise<OversightEmergency[]> {
  if (USE_MOCK) { await delay(); return O_EMERGENCIES.filter((r) => !estateId || r.estateId === estateId); }
  return getRows<OversightEmergency>(`/estate-admin/security/emergencies${qs(estateId)}`);
}

// Dues reconciliation -----------------------------------------------------------
export async function getDuesReconciliation(estateId?: string): Promise<DuesReconciliationRow[]> {
  if (USE_MOCK) { await delay(); return O_RECON.filter((r) => !estateId || r.estateId === estateId); }
  return getRows<DuesReconciliationRow>(`/estate-admin/dues/reconciliation${qs(estateId)}`);
}
export async function listOversightPayments(estateId?: string): Promise<OversightPayment[]> {
  if (USE_MOCK) { await delay(); return O_PAYMENTS.filter((r) => !estateId || r.estateId === estateId); }
  return getRows<OversightPayment>(`/estate-admin/dues/payments${qs(estateId)}`);
}
export async function listOversightRestrictions(estateId?: string): Promise<OversightRestriction[]> {
  if (USE_MOCK) { await delay(); return O_RESTRICTIONS.filter((r) => !estateId || r.estateId === estateId); }
  return getRows<OversightRestriction>(`/estate-admin/dues/restrictions${qs(estateId)}`);
}

// Ops queues --------------------------------------------------------------------
export async function listOversightRepairs(estateId?: string): Promise<OversightRepair[]> {
  if (USE_MOCK) { await delay(); return O_REPAIRS.filter((r) => !estateId || r.estateId === estateId); }
  return getRows<OversightRepair>(`/estate-admin/ops/repairs${qs(estateId)}`);
}
export async function listOversightTasks(estateId?: string): Promise<OversightTask[]> {
  if (USE_MOCK) { await delay(); return O_TASKS.filter((r) => !estateId || r.estateId === estateId); }
  return getRows<OversightTask>(`/estate-admin/ops/tasks${qs(estateId)}`);
}
export async function listOversightMeetings(estateId?: string): Promise<OversightMeeting[]> {
  if (USE_MOCK) { await delay(); return O_MEETINGS.filter((r) => !estateId || r.estateId === estateId); }
  return getRows<OversightMeeting>(`/estate-admin/ops/meetings${qs(estateId)}`);
}
export async function listOversightFacilities(estateId?: string): Promise<OversightFacility[]> {
  if (USE_MOCK) { await delay(); return O_FACILITIES.filter((r) => !estateId || r.estateId === estateId); }
  return getRows<OversightFacility>(`/estate-admin/ops/facilities${qs(estateId)}`);
}

// Content -----------------------------------------------------------------------
export async function listOversightAnnouncements(estateId?: string): Promise<OversightAnnouncement[]> {
  if (USE_MOCK) { await delay(); return O_ANNOUNCEMENTS.filter((r) => !estateId || r.estateId === estateId); }
  return getRows<OversightAnnouncement>(`/estate-admin/content/announcements${qs(estateId)}`);
}
export async function listOversightDocuments(estateId?: string): Promise<OversightDocument[]> {
  if (USE_MOCK) { await delay(); return O_DOCUMENTS.filter((r) => !estateId || r.estateId === estateId); }
  return getRows<OversightDocument>(`/estate-admin/content/documents${qs(estateId)}`);
}

// Election integrity ------------------------------------------------------------
export async function listOversightElections(estateId?: string): Promise<OversightElection[]> {
  if (USE_MOCK) { await delay(); return O_ELECTIONS.filter((r) => !estateId || r.estateId === estateId); }
  return getRows<OversightElection>(`/estate-admin/elections${qs(estateId)}`);
}
export async function getElectionResults(electionId: string): Promise<ElectionResultRow[]> {
  if (USE_MOCK) { await delay(); return O_RESULTS[electionId] ?? []; }
  return getRows<ElectionResultRow>(`/estate-admin/elections/${electionId}/results`);
}
export async function getElectionAudit(electionId: string): Promise<ElectionAudit> {
  if (USE_MOCK) { await delay(); return O_AUDIT[electionId] ?? { electionId, ballotsCast: 0, distinctVoters: 0, candidates: 0, status: null, doubleVoteDetected: false }; }
  const row = await getJson<Record<string, unknown>>(`/estate-admin/elections/${electionId}/audit`);
  return toCamel<ElectionAudit>(row);
}
