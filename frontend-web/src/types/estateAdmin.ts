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

// ── Platform estate oversight (backend /api/finance/estate-admin/*) ───────────
// Read-only cross-estate oversight surfaces, RBAC-gated on estate.admin.*.
// Every row carries estateId so HQ can scope or sweep across estates.

export interface OversightIncident {
  id: string;
  estateId: string;
  guardId: string;
  gateId: string | null;
  incidentType: string;   // trespassing|altercation|theft|suspicious|vehicle|medical|fire|other
  description: string;
  evidenceUrl: string | null;
  escalated: boolean;
  createdAt: string;
}

export interface OversightGuardShift {
  id: string;
  estateId: string;
  guardId: string;
  gateId: string;
  startedAt: string;
  endedAt: string | null;
  relievedBy: string | null;
  handoverNotes: string | null;
  onDuty: boolean;
}

export interface OversightVisitorLog {
  id: string;
  estateId: string;
  guardId: string;
  eventType: string;      // checkin|checkout|incident|vehicle
  payload: Record<string, unknown>;
  capturedAt: string;
  syncedAt: string;
}

export interface OversightEmergency {
  id: string;
  estateId: string;
  reporterId: string;
  kind: string;           // panic|medical|fire|security|noise|theft|domestic|other
  description: string | null;
  location: string | null;
  status: 'open' | 'responding' | 'resolved';
  createdAt: string;
}

export interface DuesReconciliationRow {
  estateId: string;
  billedKobo: number;
  collectedKobo: number;     // sum of successful estate_payments
  paidInvoiceKobo: number;   // sum of invoices marked paid
  outstandingKobo: number;
  overdueCount: number;
  varianceKobo: number;      // collected − paid_invoice (projection drift signal)
}

export interface OversightPayment {
  id: string;
  estateId: string;
  invoiceId: string | null;
  payerId: string;
  amountKobo: number;
  method: 'wallet' | 'card' | 'transfer' | 'ussd';
  status: 'pending' | 'successful' | 'failed' | 'refunded';
  reference: string | null;
  createdAt: string;
}

export interface OversightRestriction {
  id: string;
  estateId: string;
  residentId: string;
  invoiceId: string | null;
  level: 'soft' | 'hard';
  reason: string | null;
  active: boolean;
  appliedBy: string | null;
  liftedAt: string | null;
  createdAt: string;
}

export interface OversightRepair {
  id: string;
  estateId: string;
  propertyId: string | null;
  reporterId: string;
  category: string;
  description: string;
  urgency: 'low' | 'medium' | 'high';
  status: string;         // reported|inspection|assigned|in_progress|completed|reopened|cancelled
  vendorId: string | null;
  costEstimateKobo: number | null;
  createdAt: string;
}

export interface OversightTask {
  id: string;
  estateId: string;
  title: string;
  description: string | null;
  assigneeId: string | null;
  createdBy: string;
  dueDate: string | null;
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'in_progress' | 'done';
  createdAt: string;
}

export interface OversightMeeting {
  id: string;
  estateId: string;
  title: string;
  agenda: string | null;
  mode: 'physical' | 'virtual' | 'hybrid';
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  createdBy: string;
  createdAt: string;
}

export interface OversightFacility {
  id: string;
  estateId: string;
  name: string;
  kind: string;
  capacity: number | null;
  feeKobo: number;
  createdAt: string;
}

export interface OversightAnnouncement {
  id: string;
  estateId: string;
  title: string;
  body: string;
  kind: string;           // general|emergency|security|payment|maintenance|meeting|election
  createdBy: string;
  createdAt: string;
}

export interface OversightDocument {
  id: string;
  estateId: string;
  title: string;
  category: string;
  fileUrl: string;
  uploadedBy: string;
  restricted: boolean;
  createdAt: string;
}

export interface OversightElection {
  id: string;
  estateId: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  status: 'draft' | 'open' | 'closed' | 'tallied';
  createdBy: string;
  createdAt: string;
}

export interface ElectionResultRow {
  candidateId: string;
  name: string;
  bio: string;
  votes: number;
}

export interface ElectionAudit {
  electionId: string;
  ballotsCast: number;
  distinctVoters: number;
  candidates: number;
  status: string | null;
  doubleVoteDetected: boolean;
}
