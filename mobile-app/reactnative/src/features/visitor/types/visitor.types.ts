// ── Visitor & Estate Access Management — Type Contract ───────────────────────
// Source of truth for the Visitor module (PRD: docs/prd/Visitor.md).
// Owned by the "Backend" role. Frontend codes against these types only and
// must not reach into the mock implementation in ../api/visitor.api.ts.

// §9 Code Type Specification
export type CodeType =
  | 'one_time'
  | 'time_limited'
  | 'date_specific'
  | 'multi_day'
  | 'recurring'
  | 'delivery'
  | 'ride_hailing'
  | 'domestic_staff'
  | 'contractor'
  | 'event_guest'
  | 'family_permanent'
  | 'vip'
  | 'emergency';

// §12 AccessCode.status
export type AccessCodeStatus = 'active' | 'expired' | 'revoked' | 'used';

// §12 VisitEvent.action
export type VisitAction =
  | 'arrival'
  | 'check_in'
  | 'check_out'
  | 'deny'
  | 'walk_in'
  | 'emergency';

// VM-261/262 sync state
export type SyncStatus = 'synced' | 'pending';

// §10 Payment-gating restriction states
export type RestrictionState =
  | 'good_standing'
  | 'soft_restriction'
  | 'hard_ban'
  | 'restoration_pending'
  | 'access_restored';

export interface AccessCode {
  id: string;
  estateId: string;
  hostResidentId: string;
  hostName: string;
  propertyId: string;
  unitLabel: string;            // e.g. "Block C, Flat 4"
  estateName: string;
  codeValue: string;            // 6–8 digit human-readable code (VM-101)
  qrPayload: string;            // signed payload string for the QR (VM-101)
  codeType: CodeType;
  purposeLabel: string;         // guard-visible label (VM-103)
  status: AccessCodeStatus;
  visitor: VisitorDetails;
  validityStart: string;        // ISO
  validityEnd: string;          // ISO
  maxEntries: number;
  entriesUsed: number;
  usageMode: CodeUsageMode;     // entry+exit (re-entry) vs single one-time entry
  partySize: number;            // number of guests this code admits
  recurrenceRule?: string | null;
  createdAt: string;            // ISO
  createdBy: string;
}

// How a code may be used at the gate.
export type CodeUsageMode = 'entry_exit' | 'one_time';

// Derived live attendance for a code (from VisitEvents).
export interface CodeAttendance {
  arrived: boolean;
  inside: boolean;
  checkIns: number;
  checkOuts: number;
  lastInAt?: string;
  lastOutAt?: string;
  lastQueriedAt?: string;       // last time a guard looked the code up at a gate
}

// §12 Visitor entity (subset captured at creation; rest captured at gate)
export interface VisitorDetails {
  id?: string;
  name: string;
  phone?: string;
  purpose?: string;
  expectedArrival?: string;     // ISO
  vehiclePlate?: string;
  vehicleDesc?: string;
  isBlacklisted?: boolean;
  blacklistReason?: string;
  photoRef?: string;
}

export interface VisitEvent {
  id: string;
  accessCodeId?: string;
  visitorName: string;
  unitLabel: string;
  gateId: string;
  guardId: string;
  action: VisitAction;
  reason?: string;              // mandatory on deny (VM-208)
  timestamp: string;            // ISO
  syncStatus: SyncStatus;
  capturedPlate?: string;
  codeType?: CodeType;
}

export interface GateSession {
  id: string;
  gateId: string;
  gateLabel: string;
  guardId: string;
  guardName: string;
  shiftStart: string;           // ISO
  shiftEnd?: string | null;
  handoverNotes?: string;
}

export interface RestrictionStatus {
  residentId: string;
  estateId: string;
  state: RestrictionState;
  outstandingBalanceKobo: number;   // minor units (kobo) per money iron-rules
  effectiveFrom: string;            // ISO
  source: 'payments';
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface CreateAccessCodeInput {
  codeType: CodeType;
  visitorName: string;
  visitorPhone?: string;
  purpose?: string;
  expectedArrival?: string;     // ISO
  vehiclePlate?: string;
  vehicleDesc?: string;
  validityStart: string;        // ISO
  validityEnd: string;          // ISO
  maxEntries: number;
  usageMode: CodeUsageMode;
  partySize: number;
  recurrenceRule?: string;      // VM-105: e.g. "MON,WED,FRI 07:00-18:00" (recurring/staff)
  idempotencyKey: string;       // every mutation carries one (money/audit parity)
}

// Guard records an exit for an entry+exit code (check-out by code value).
export interface RecordExitInput {
  accessCodeId: string;
  gateId: string;
  idempotencyKey: string;
}

// A single phonebook contact (resident-side picker; simulated source).
export interface PhonebookContact {
  id: string;
  name: string;
  phone: string;
}

export type ShareChannel = 'whatsapp' | 'sms' | 'email';

// Result of a gate code lookup (online or offline-cached) — VM-202/203/204
export type LookupOutcome =
  | { kind: 'ok'; code: AccessCode }
  | { kind: 'expired'; codeValue: string }
  | { kind: 'used'; codeValue: string }
  | { kind: 'revoked'; codeValue: string }
  | { kind: 'blacklisted'; code: AccessCode }
  | { kind: 'not_found'; codeValue: string };

export interface GuardCapture {
  plate?: string;
  photoCaptured?: boolean;
  idCaptured?: boolean;
}

export interface ApproveEntryInput {
  accessCodeId: string;
  gateId: string;
  capture?: GuardCapture;
  idempotencyKey: string;
}

export interface DenyEntryInput {
  accessCodeId?: string;
  codeValue: string;
  gateId: string;
  reason: string;               // mandatory (VM-208/243)
  idempotencyKey: string;
}

// VM-212 — a visit that is checked-in but not yet checked-out.
export interface OpenVisit {
  visitEventId: string;
  accessCodeId?: string;
  visitorName: string;
  unitLabel: string;
  codeType?: CodeType;
  partySize?: number;
  checkedInAt: string;          // ISO
  capturedPlate?: string;
}

// VM-213 — an open visit that has exceeded its expected/allowed duration.
export interface OverstayVisit extends OpenVisit {
  expectedEnd: string;          // ISO — code validity end (or fallback window)
  overdueByMinutes: number;
}

export interface CheckOutInput {
  visitEventId: string;
  gateId: string;
  idempotencyKey: string;
}

// VM-215 — guard-initiated entry with no pre-issued code.
export interface WalkInInput {
  visitorName: string;
  unitLabel: string;            // host unit
  visitorPhone?: string;
  purpose?: string;
  emergency: boolean;           // true → fast-track / flagged for review
  gateId: string;
  idempotencyKey: string;
}

// VM-216 — shift handover summary passed to the next guard.
export interface HandoverInput {
  gateId: string;
  notes: string;
  idempotencyKey: string;
}

// ── Notifications (Section W) ────────────────────────────────────────────────
export type VisitorNotificationType =
  | 'arrival'        // VM-161
  | 'checked_in'     // VM-162
  | 'checked_out'    // VM-163
  | 'overstayed'     // VM-164
  | 'denied'         // VM-165
  | 'restriction'    // payment restriction change
  | 'access_restored';

export interface VisitorNotification {
  id: string;
  type: VisitorNotificationType;
  title: string;
  body: string;
  timestamp: string;     // ISO
  read: boolean;
  accessCodeId?: string;
}

// ── Blacklist (VM-241 / 244) ─────────────────────────────────────────────────
export type BlacklistMatchKind = 'phone' | 'id' | 'plate';

export interface BlacklistEntry {
  id: string;
  estateId: string;
  matchKind: BlacklistMatchKind;
  matchValue: string;
  name?: string;
  reason: string;
  createdBy: string;
  createdAt: string;     // ISO
}

export interface BlacklistInput {
  matchKind: BlacklistMatchKind;
  matchValue: string;
  name?: string;
  reason: string;
  idempotencyKey: string;
}

// ── Incident / suspicious (VM-242 / 217) ─────────────────────────────────────
export type IncidentKind = 'suspicious' | 'incident';
export type IncidentSeverity = 'low' | 'medium' | 'high';

export interface IncidentInput {
  kind: IncidentKind;
  severity: IncidentSeverity;
  title: string;
  description: string;
  gateId: string;
  escalate: boolean;
  idempotencyKey: string;
}

export interface IncidentReport extends Omit<IncidentInput, 'idempotencyKey'> {
  id: string;
  status: 'open' | 'escalated' | 'resolved';
  createdAt: string;     // ISO
}

// ── Analytics (Section X / §14) ──────────────────────────────────────────────
export interface VisitorAnalytics {
  rangeLabel: string;
  totalEntries: number;
  totalDenials: number;
  overstays: number;
  avgVerificationSeconds: number;
  offlineSyncedPct: number;
  byType: { label: string; value: number }[];        // delivery vs guest vs staff…
  byHour: { hour: string; value: number }[];          // peak times
  restrictionImpact: { restrictedResidents: number; avgRestoreMinutes: number };
}

// ── Lookup (VM-204) ──────────────────────────────────────────────────────────
export interface ResidentDirectoryEntry {
  id: string;
  name: string;
  unitLabel: string;
  phone: string;
}

export interface LookupResults {
  query: string;
  codes: AccessCode[];
  residents: ResidentDirectoryEntry[];
}

// ── Event guest bulk (VM-107) ────────────────────────────────────────────────
export interface EventGuestInput {
  eventName: string;
  guestNames: string[];
  validityStart: string;   // ISO
  validityEnd: string;     // ISO
  idempotencyKey: string;
}

export interface EventGuestManifest {
  eventCodeId: string;
  eventName: string;
  guests: { name: string; codeValue: string }[];
  validityEnd: string;
}
