// ── Admin — Estate control plane types ───────────────────────────────────────
// All money is integer minor units (kobo). Mirrors realtorAdmin.ts conventions.

export interface EstateKpis {
  residents: number;
  units: number;
  collectionsThisCycleKobo: number; // collected so far this billing cycle
  expectedThisCycleKobo: number;    // total billed this cycle
  openIncidents: number;
  activeVendors: number;
  arrearsKobo: number;
}

export interface EstateActivity {
  id: string;
  kind: 'payment' | 'incident' | 'vendor' | 'resident' | 'gate';
  summary: string;
  actor: string;
  at: string; // ISO
}

export type ResidentRole = 'owner' | 'tenant';
export type ResidentStatus = 'active' | 'banned';

export interface AdminResident {
  id: string;
  name: string;
  unit: string;        // e.g. "Block B · Flat 4"
  role: ResidentRole;
  phone: string;
  status: ResidentStatus;
  arrearsKobo: number;
  joinedAt: string;
}

export type DuesStatus = 'paid' | 'pending' | 'overdue' | 'restricted';

export interface AdminDuesInvoice {
  id: string;
  reference: string;
  unit: string;
  residentName: string;
  description: string;     // e.g. "Q2 Service charge"
  amountKobo: number;
  paidKobo: number;
  status: DuesStatus;
  dueAt: string;
  restricted: boolean;     // access restriction applied for non-payment
}

export type GateStatus = 'online' | 'offline' | 'maintenance';

export interface AdminGate {
  id: string;
  name: string;          // e.g. "Main Gate"
  location: string;
  status: GateStatus;
  guardsOnDuty: number;
  lastHeartbeat: string;
}

export interface AdminGuardShift {
  id: string;
  guardName: string;
  gate: string;
  shift: 'day' | 'night';
  startsAt: string;
  endsAt: string;
  status: 'scheduled' | 'on_duty' | 'completed' | 'missed';
}

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'open' | 'investigating' | 'resolved';

export interface AdminIncident {
  id: string;
  title: string;
  gate: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  reportedBy: string;
  reportedAt: string;
}

export type VendorStatus = 'pending' | 'verified' | 'rejected' | 'suspended';

export interface AdminVendor {
  id: string;
  name: string;
  trade: string;          // e.g. "Electrician", "Plumber"
  phone: string;
  rating: number;         // 0-5
  jobsCompleted: number;
  status: VendorStatus;
  submittedAt: string;
}

// ── Property suite (cross-vertical context + rent passport) ───────────────────
export type PropertyRole = 'resident' | 'tenant' | 'owner' | 'agent' | 'guard' | 'estate_admin' | 'agency';

export interface PropertyContext {
  userId: string;
  activeRole: PropertyRole;
  availableRoles: PropertyRole[];
  estateId?: string;
  agencyId?: string;
  permissions: string[];
}

export interface RentPassport {
  userId: string;
  displayName: string;
  score: number;                 // 0-1000 tenancy reliability
  onTimePaymentRatePct: number;
  tenanciesCompleted: number;
  activeTenancies: number;
  totalRentPaidKobo: number;
  arrearsKobo: number;
  verifiedIdentity: boolean;
  issuedAt: string;
}
