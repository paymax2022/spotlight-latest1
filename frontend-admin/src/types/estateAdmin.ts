// All money is integer minor units (kobo). Mirrors realtorAdmin.ts conventions.

// Mirrors the live AdminDashboard struct (backend/internal/estate/admin.go
// GetAdminDashboard) exactly — {estate_id, residents, banned_residents,
// open_repairs, open_incidents, defaulters, outstanding_dues_kobo,
// verified_vendors, pending_transfers}. `units`, `collectionsThisCycleKobo`
// and `expectedThisCycleKobo` were part of the old mock-only shape and have
// NO backend source on this endpoint (no billing-cycle concept exists here)
// — dropped rather than left silently undefined. `arrearsKobo` maps to
// outstanding_dues_kobo and `activeVendors` to verified_vendors, the closest
// real semantics available.
export interface EstateKpis {
  residents: number;
  bannedResidents: number;
  openRepairs: number;
  openIncidents: number;
  defaulters: number;
  arrearsKobo: number;   // outstanding_dues_kobo
  activeVendors: number; // verified_vendors
  pendingTransfers: number;
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
  userId: string;
  name: string;
  unit: string;        // e.g. "Block B · Flat 4"
  role: ResidentRole;
  phone: string;
  status: ResidentStatus;
  arrearsKobo: number;
  createdAt: string;
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

export interface OversightFacilityBooking {
  id: string;
  estateId: string;
  facilityId: string;
  residentId: string;
  residentName: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  amountKobo: number;
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
  status: 'draft' | 'open' | 'closed' | 'tallied' | 'cancelled';
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

// Election governance (Phase 2.2). Mirrors the Go service structs in
// backend/internal/estate/election_governance.go, camelCased by estateAdminService.
export type ElectionVerdict =
  | 'decided' | 'tie' | 'runoff_required' | 'no_quorum' | 'cancelled' | 'no_ballots';

export interface ElectionGovernanceState {
  id: string;
  estateId: string;
  title: string;
  description?: string;
  startsAt: string;
  endsAt: string;
  status: 'draft' | 'open' | 'closed' | 'tallied' | 'cancelled';
  kind: 'binding' | 'poll';
  weighting: 'one_person_one_vote' | 'one_vote_per_unit';
  quorumType: 'none' | 'count' | 'percent';
  quorumValue: number;
  tieBreak: 'none' | 'earliest_candidate' | 'runoff';
  nominationOpensAt?: string;
  nominationClosesAt?: string;
  rollFrozenAt?: string;
  rulesLockedAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
}

export interface ElectionOutcomeRow {
  electionId: string;
  title: string;
  kind: string;
  status: string;
  weighting: string;
  binding: boolean;
  eligibleVoters: number;
  ballotsAvailable: number;
  votersCast: number;
  ballotsCast: number;
  abstentions: number;
  turnoutPercent: number;
  quorumType: string;
  quorumValue: number;
  quorumRequired: number;
  quorumMet: boolean;
  results: { id: string; electionId: string; name: string; bio?: string; votes?: number }[];
  topVotes: number;
  winnerIds?: string[];
  tieBreak: string;
  verdict: ElectionVerdict;
  tieBreakNote?: string;
  cancellationReason?: string;
  openComplaints: number;
}

export interface ElectionTurnoutRow {
  electionId: string;
  status: string;
  weighting: string;
  eligibleVoters: number;
  ballotsAvailable: number;
  votersCast: number;
  ballotsCast: number;
  turnoutPercent: number;
  quorumType: string;
  quorumValue: number;
  quorumRequired: number;
  quorumMet: boolean;
}

export interface ElectionRollRow {
  id: string;
  electionId: string;
  version: number;
  status: 'draft' | 'frozen';
  builtBy?: string;
  builtAt: string;
  frozenBy?: string;
  frozenAt?: string;
  eligibleCount: number;
  totalBallots: number;
}

export interface ElectionRollEntryRow {
  rollId: string;
  userId: string;
  fullName: string;
  unit: string;
  occupancyType: string;
  weight: number;
  source: 'built' | 'exception';
  status: 'active' | 'removed';
  removalReason?: string;
}

export interface RollChallengeRow {
  id: string;
  electionId: string;
  rollId: string;
  subjectUserId: string;
  subjectName: string;
  raisedBy: string;
  reason: string;
  state: 'open' | 'upheld' | 'rejected';
  resolvedBy?: string;
  resolvedAt?: string;
  resolution?: string;
  createdAt: string;
}

export interface NominationRow {
  id: string;
  electionId: string;
  nomineeUserId: string;
  nomineeName: string;
  nominatedBy?: string;
  nominatedName?: string;
  seat?: string;
  statement?: string;
  state: 'nominated' | 'accepted' | 'declined' | 'withdrawn' | 'rejected' | 'certified';
  vettingState: 'pending' | 'cleared' | 'flagged';
  reason?: string;
  candidateId?: string;
  createdAt: string;
  decidedAt?: string;
}

export interface RuleProposalRow {
  id: string;
  electionId: string;
  requireKyc: boolean;
  requirePayment: boolean;
  residentTypes: string[];
  proposedBy: string;
  proposedAt: string;
  state: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
}

export interface ElectionComplaintRow {
  id: string;
  electionId: string;
  raisedBy: string;
  kind: 'complaint' | 'recount';
  detail: string;
  state: 'open' | 'upheld' | 'dismissed';
  resolvedBy?: string;
  resolvedAt?: string;
  resolution?: string;
  createdAt: string;
}

export interface ElectionRecountRow {
  id: string;
  electionId: string;
  requestedBy?: string;
  complaintId?: string;
  talliedAt: string;
  ballotsCast: number;
  abstentions: number;
  totals: { id: string; electionId: string; name: string; bio?: string; votes?: number }[];
  note?: string;
}

export type OccupancyStatus = 'vacant' | 'occupied' | 'reserved';
export type TransferType = 'ownership' | 'tenancy';
export type TransferStatus = 'pending' | 'approved' | 'rejected';

export interface AdminProperty {
  id: string;
  estateId: string;
  unitLabel: string;
  propertyType: string; // apartment | house | commercial | land | other
  floor: string;
  block: string;
  occupancyStatus: OccupancyStatus;
  landlordId: string | null;
  tenantId: string | null;
  archived: boolean;
  createdAt: string;
}

export interface PropertyTransferRequest {
  id: string;
  estateId: string;
  propertyId: string;
  requestedBy: string;
  toUserId: string;
  transferType: TransferType;
  reason: string;
  status: TransferStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}
