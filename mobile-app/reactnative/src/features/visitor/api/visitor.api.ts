//   • USE_MOCK === true  → in-memory mock (visitor.mock.ts) with simulated latency
//   • USE_MOCK === false → real HTTP against the /visitor endpoints via api/client
// Signatures, types, and the hooks above this layer are identical for both paths,
// so flipping EXPO_PUBLIC_VISITOR_USE_MOCK=false is the only change needed to go live.
// mutations carry an Idempotency-Key.

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { USE_MOCK, VISITOR_API_BASE as B } from '../constants/visitor.constants';
import type {
  AccessCode,
  ApproveEntryInput,
  BlacklistEntry,
  BlacklistInput,
  CheckOutInput,
  CodeAttendance,
  CreateAccessCodeInput,
  DenyEntryInput,
  EventGuestInput,
  EventGuestManifest,
  GateSession,
  HandoverInput,
  IncidentInput,
  IncidentReport,
  LookupOutcome,
  LookupResults,
  OpenVisit,
  OverstayVisit,
  PhonebookContact,
  RecordExitInput,
  RestrictionStatus,
  VisitEvent,
  VisitorAnalytics,
  VisitorNotification,
  WalkInInput,
} from '../types/visitor.types';
import {
  seedCodes,
  seedEvents,
  seedGateSession,
  seedRestriction,
} from './visitor.mock';
import {
  seedAnalytics,
  seedBlacklist,
  seedContacts,
  seedIncidents,
  seedNotifications,
  seedResidents,
} from './visitor.extras.mock';

// Mutable in-memory stores (used only when USE_MOCK).
let codes: AccessCode[] = [...seedCodes];
let events: VisitEvent[] = [...seedEvents];
let restriction: RestrictionStatus = { ...seedRestriction };
let gateSession: GateSession = { ...seedGateSession };
let notifications: VisitorNotification[] = [...seedNotifications];
let blacklist: BlacklistEntry[] = [...seedBlacklist];
let incidents: IncidentReport[] = [...seedIncidents];

const latency = (ms = 450) => new Promise((r) => setTimeout(r, ms));

// Every write in this file has a live route handler (frontend-web/app/api/v1/visitor/**,
// real Supabase queries), so fixture mode refuses loudly instead of reporting a code
// created, an entry approved or a visitor blacklisted that never reached the database —
// mirrors frontend-admin's crowdfundingAdminService.ts NOT_IN_FIXTURE_MODE pattern.
const notInFixtureMode = (action: string) =>
  new Error(`${action} is unavailable in fixture mode: this app will not report a write it did not perform. Set EXPO_PUBLIC_VISITOR_USE_MOCK=false to send this against the live backend.`);
const idem = (key?: string) => ({ headers: { 'Idempotency-Key': key ?? generateIdempotencyKey() } });

/** Simple typed error so the UI error-state contract is predictable. */
export class VisitorApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'VisitorApiError';
  }
}

export async function getRestrictionStatus(): Promise<RestrictionStatus> {
  if (USE_MOCK) {
    await latency(300);
    return { ...restriction };
  }
  const { data } = await api.get<RestrictionStatus>(`${B}/restriction`);
  return data;
}

/** Test/demo helper to drive the restriction screens without a Payments backend. */
export function __setRestriction(next: Partial<RestrictionStatus>): void {
  restriction = { ...restriction, ...next };
}

export async function listAccessCodes(): Promise<AccessCode[]> {
  if (USE_MOCK) {
    await latency();
    return codes.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  const { data } = await api.get<AccessCode[]>(`${B}/codes`);
  return data;
}

export async function getAccessCode(id: string): Promise<AccessCode> {
  if (USE_MOCK) {
    await latency(250);
    const code = codes.find((c) => c.id === id);
    if (!code) throw new VisitorApiError('NOT_FOUND', 'Access code not found.');
    return { ...code };
  }
  const { data } = await api.get<AccessCode>(`${B}/codes/${id}`);
  return data;
}

export async function createAccessCode(input: CreateAccessCodeInput): Promise<AccessCode> {
  if (USE_MOCK) throw notInFixtureMode('Creating an access code');
  const { data } = await api.post<AccessCode>(`${B}/codes`, input, idem(input.idempotencyKey));
  return data;
}

export async function revokeAccessCode(id: string): Promise<AccessCode> {
  if (USE_MOCK) throw notInFixtureMode('Revoking an access code');
  const { data } = await api.post<AccessCode>(`${B}/codes/${id}/revoke`, {}, idem());
  return data;
}

export async function extendAccessCode(id: string, newValidityEnd: string): Promise<AccessCode> {
  if (USE_MOCK) throw notInFixtureMode('Extending an access code');
  const { data } = await api.post<AccessCode>(`${B}/codes/${id}/extend`, { validityEnd: newValidityEnd }, idem());
  return data;
}

// VM-121/123: re-share returns the same code unchanged (no regeneration).
export async function logShare(id: string): Promise<void> {
  if (USE_MOCK) throw notInFixtureMode('Logging a code share');
  await api.post(`${B}/codes/${id}/share`, {});
}

export async function listVisitHistory(): Promise<VisitEvent[]> {
  if (USE_MOCK) {
    await latency();
    return events.slice().sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
  }
  const { data } = await api.get<VisitEvent[]>(`${B}/history`);
  return data;
}

export async function getGateSession(): Promise<GateSession> {
  if (USE_MOCK) {
    await latency(300);
    return { ...gateSession };
  }
  const { data } = await api.get<GateSession>(`${B}/gate/session`);
  return data;
}

export async function listExpectedVisitors(): Promise<AccessCode[]> {
  if (USE_MOCK) {
    await latency();
    // Today's still-valid codes for the gate (VM-205).
    const now = Date.now();
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    return codes
      .filter((c) => c.status === 'active' && +new Date(c.validityEnd) >= now && +new Date(c.validityStart) <= +endOfDay)
      .sort((a, b) => +new Date(a.visitor.expectedArrival ?? a.validityEnd) - +new Date(b.visitor.expectedArrival ?? b.validityEnd));
  }
  const { data } = await api.get<AccessCode[]>(`${B}/gate/expected`);
  return data;
}

export async function listGateLog(): Promise<VisitEvent[]> {
  if (USE_MOCK) {
    return listVisitHistory();
  }
  const { data } = await api.get<VisitEvent[]>(`${B}/gate/log`);
  return data;
}

export async function pendingSyncCount(): Promise<number> {
  if (USE_MOCK) {
    await latency(150);
    return events.filter((e) => e.syncStatus === 'pending').length;
  }
  const { data } = await api.get<{ count: number }>(`${B}/gate/pending-sync-count`);
  return data.count;
}

export async function syncPendingLogs(): Promise<number> {
  if (USE_MOCK) throw notInFixtureMode('Syncing gate logs');
  const { data } = await api.post<{ synced: number }>(`${B}/gate/sync`, {}, idem());
  return data.synced;
}

// VM-202/203/204 — lookup a code by its numeric value or QR payload.
export async function lookupCode(raw: string): Promise<LookupOutcome> {
  if (USE_MOCK) {
    await latency(350);
    const value = raw.includes('|') ? raw.split('|')[2] ?? raw : raw.replace(/\s/g, '');
    const code = codes.find((c) => c.codeValue === value);
    if (!code) return { kind: 'not_found', codeValue: value };
    if (code.visitor.isBlacklisted) return { kind: 'blacklisted', code: { ...code } };
    if (code.status === 'revoked') return { kind: 'revoked', codeValue: value };
    if (code.status === 'used' || code.entriesUsed >= code.maxEntries) {
      // A consumed one-time code can still be presented for CHECK-OUT while the
      // visitor is inside; only block it once they have already departed.
      if (attendanceFromEvents(code.id).inside) return { kind: 'ok', code: { ...code } };
      return { kind: 'used', codeValue: value };
    }
    if (code.status === 'expired' || +new Date(code.validityEnd) < Date.now()) return { kind: 'expired', codeValue: value };
    return { kind: 'ok', code: { ...code } };
  }
  const { data } = await api.get<LookupOutcome>(`${B}/gate/lookup`, { params: { code: raw } });
  return data;
}

export async function approveEntry(input: ApproveEntryInput): Promise<VisitEvent> {
  if (USE_MOCK) throw notInFixtureMode('Approving a visitor entry');
  const { data } = await api.post<VisitEvent>(`${B}/gate/approve`, input, idem(input.idempotencyKey));
  return data;
}

export async function denyEntry(input: DenyEntryInput): Promise<VisitEvent> {
  if (USE_MOCK) throw notInFixtureMode('Denying a visitor entry');
  const { data } = await api.post<VisitEvent>(`${B}/gate/deny`, input, idem(input.idempotencyKey));
  return data;
}

function attendanceFromEvents(codeId: string): CodeAttendance {
  const evs = events
    .filter((e) => e.accessCodeId === codeId)
    .sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp));
  const checkIns = evs.filter((e) => e.action === 'check_in').length;
  const checkOuts = evs.filter((e) => e.action === 'check_out').length;
  const lastIn = [...evs].reverse().find((e) => e.action === 'check_in');
  const lastOut = [...evs].reverse().find((e) => e.action === 'check_out');
  const lastArrival = [...evs].reverse().find((e) => e.action === 'arrival');
  const lastMovement = [...evs].reverse().find((e) => e.action === 'check_in' || e.action === 'check_out');
  return {
    arrived: checkIns > 0,
    inside: lastMovement?.action === 'check_in',
    checkIns,
    checkOuts,
    lastInAt: lastIn?.timestamp,
    lastOutAt: lastOut?.timestamp,
    lastQueriedAt: lastArrival?.timestamp,
  };
}

export async function getCodeAttendance(codeId: string): Promise<CodeAttendance> {
  if (USE_MOCK) {
    await latency(250);
    return attendanceFromEvents(codeId);
  }
  const { data } = await api.get<CodeAttendance>(`${B}/codes/${codeId}/attendance`);
  return data;
}

// VM-161 — when a guard queries a code at the gate, log an arrival and notify
// the resident, then return the live attendance so the gate screen updates.
export async function recordArrival(accessCodeId: string, gateId: string): Promise<CodeAttendance> {
  if (USE_MOCK) throw notInFixtureMode('Recording a visitor arrival');
  const { data } = await api.post<CodeAttendance>(`${B}/codes/${accessCodeId}/arrival`, { gateId }, idem());
  return data;
}

// Record an exit for an entry+exit code (check-out by code, VM-212/163).
export async function recordExit(input: RecordExitInput): Promise<VisitEvent> {
  if (USE_MOCK) throw notInFixtureMode('Recording a visitor exit');
  const { data } = await api.post<VisitEvent>(`${B}/codes/${input.accessCodeId}/exit`, { gateId: input.gateId }, idem(input.idempotencyKey));
  return data;
}

// Resident phonebook — device-sourced, NOT a backend resource. In production this
// reads `expo-contacts` (with permission); here it returns a simulated phonebook.
// Intentionally has no HTTP path regardless of USE_MOCK.
export async function listPhonebookContacts(query = ''): Promise<PhonebookContact[]> {
  await latency(200);
  const q = query.trim().toLowerCase();
  const list = q ? seedContacts.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q)) : seedContacts;
  return list.slice();
}

// same visitor + unit.
export async function listOpenVisits(): Promise<OpenVisit[]> {
  if (USE_MOCK) {
    await latency(350);
    const closedKeys = new Set(
      events.filter((e) => e.action === 'check_out').map((e) => `${e.visitorName}|${e.unitLabel}`),
    );
    const seen = new Set<string>();
    const open: OpenVisit[] = [];
    for (const e of events) {
      if (e.action !== 'check_in' && e.action !== 'walk_in' && e.action !== 'emergency') continue;
      const key = `${e.visitorName}|${e.unitLabel}`;
      if (closedKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      const code = e.accessCodeId ? codes.find((c) => c.id === e.accessCodeId) : undefined;
      open.push({
        visitEventId: e.id,
        accessCodeId: e.accessCodeId,
        visitorName: e.visitorName,
        unitLabel: e.unitLabel,
        codeType: e.codeType,
        partySize: code?.partySize,
        checkedInAt: e.timestamp,
        capturedPlate: e.capturedPlate,
      });
    }
    return open.sort((a, b) => +new Date(a.checkedInAt) - +new Date(b.checkedInAt));
  }
  const { data } = await api.get<OpenVisit[]>(`${B}/gate/open-visits`);
  return data;
}

// VM-213 — open visits past their expected/allowed duration. For coded visits
// a fixed window from check-in.
const WALKIN_WINDOW_MS = 8 * 3_600_000;
export async function listOverstays(): Promise<OverstayVisit[]> {
  if (USE_MOCK) {
    const open = await listOpenVisits();
    const now = Date.now();
    const overstays: OverstayVisit[] = [];
    for (const v of open) {
      const code = v.accessCodeId ? codes.find((c) => c.id === v.accessCodeId) : undefined;
      const expectedEnd = code ? code.validityEnd : new Date(+new Date(v.checkedInAt) + WALKIN_WINDOW_MS).toISOString();
      const overdueMs = now - +new Date(expectedEnd);
      if (overdueMs > 0) {
        overstays.push({ ...v, expectedEnd, overdueByMinutes: Math.floor(overdueMs / 60_000) });
      }
    }
    return overstays.sort((a, b) => b.overdueByMinutes - a.overdueByMinutes);
  }
  const { data } = await api.get<OverstayVisit[]>(`${B}/gate/overstays`);
  return data;
}

export async function checkOutVisit(input: CheckOutInput): Promise<VisitEvent> {
  if (USE_MOCK) throw notInFixtureMode('Checking out a visit');
  const { data } = await api.post<VisitEvent>(`${B}/gate/checkout`, input, idem(input.idempotencyKey));
  return data;
}

export async function createWalkIn(input: WalkInInput): Promise<VisitEvent> {
  if (USE_MOCK) throw notInFixtureMode('Registering a walk-in');
  const { data } = await api.post<VisitEvent>(`${B}/gate/walkin`, input, idem(input.idempotencyKey));
  return data;
}

export async function getOpenVisitCount(): Promise<number> {
  if (USE_MOCK) {
    const open = await listOpenVisits();
    return open.length;
  }
  const { data } = await api.get<{ count: number }>(`${B}/gate/open-visits/count`);
  return data.count;
}

export async function submitHandover(input: HandoverInput): Promise<GateSession> {
  if (USE_MOCK) throw notInFixtureMode('Submitting a shift handover');
  const { data } = await api.post<GateSession>(`${B}/gate/handover`, input, idem(input.idempotencyKey));
  return data;
}

export async function listNotifications(): Promise<VisitorNotification[]> {
  if (USE_MOCK) {
    await latency();
    return notifications.slice().sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
  }
  const { data } = await api.get<VisitorNotification[]>(`${B}/notifications`);
  return data;
}

export async function markNotificationRead(id: string): Promise<void> {
  if (USE_MOCK) throw notInFixtureMode('Marking a notification read');
  await api.post(`${B}/notifications/${id}/read`, {});
}

export async function markAllNotificationsRead(): Promise<void> {
  if (USE_MOCK) throw notInFixtureMode('Marking all notifications read');
  await api.post(`${B}/notifications/read-all`, {});
}

export async function unreadNotificationCount(): Promise<number> {
  if (USE_MOCK) {
    await latency(120);
    return notifications.filter((n) => !n.read).length;
  }
  const { data } = await api.get<{ count: number }>(`${B}/notifications/unread-count`);
  return data.count;
}

export async function listBlacklist(): Promise<BlacklistEntry[]> {
  if (USE_MOCK) {
    await latency();
    return blacklist.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  const { data } = await api.get<BlacklistEntry[]>(`${B}/blacklist`);
  return data;
}

export async function addBlacklist(input: BlacklistInput): Promise<BlacklistEntry> {
  if (USE_MOCK) throw notInFixtureMode('Adding to the blacklist');
  const { data } = await api.post<BlacklistEntry>(`${B}/blacklist`, input, idem(input.idempotencyKey));
  return data;
}

export async function removeBlacklist(id: string): Promise<void> {
  if (USE_MOCK) throw notInFixtureMode('Removing from the blacklist');
  await api.delete(`${B}/blacklist/${id}`);
}

export async function listIncidents(): Promise<IncidentReport[]> {
  if (USE_MOCK) {
    await latency();
    return incidents.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  const { data } = await api.get<IncidentReport[]>(`${B}/incidents`);
  return data;
}

export async function submitIncident(input: IncidentInput): Promise<IncidentReport> {
  if (USE_MOCK) throw notInFixtureMode('Reporting an incident');
  const { data } = await api.post<IncidentReport>(`${B}/incidents`, input, idem(input.idempotencyKey));
  return data;
}

export async function getVisitorAnalytics(): Promise<VisitorAnalytics> {
  if (USE_MOCK) {
    await latency(500);
    return JSON.parse(JSON.stringify(seedAnalytics));
  }
  const { data } = await api.get<VisitorAnalytics>(`${B}/analytics`);
  return data;
}

export async function lookupVisitorsAndResidents(query: string): Promise<LookupResults> {
  if (USE_MOCK) {
    await latency(300);
    const q = query.trim().toLowerCase();
    if (!q) return { query, codes: [], residents: [] };
    const matchedCodes = codes.filter(
      (c) =>
        c.codeValue.includes(q) ||
        c.visitor.name.toLowerCase().includes(q) ||
        (c.visitor.phone ?? '').includes(q) ||
        (c.visitor.vehiclePlate ?? '').toLowerCase().includes(q),
    );
    const residents = seedResidents.filter(
      (r) => r.name.toLowerCase().includes(q) || r.unitLabel.toLowerCase().includes(q) || r.phone.includes(q),
    );
    return { query, codes: matchedCodes, residents };
  }
  const { data } = await api.get<LookupResults>(`${B}/search`, { params: { q: query } });
  return data;
}

export async function listVehicleEntries(): Promise<VisitEvent[]> {
  if (USE_MOCK) {
    await latency();
    return events
      .filter((e) => !!e.capturedPlate && (e.action === 'check_in' || e.action === 'check_out'))
      .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
  }
  const { data } = await api.get<VisitEvent[]>(`${B}/gate/vehicles`);
  return data;
}

export async function createEventGuestCodes(input: EventGuestInput): Promise<EventGuestManifest> {
  if (USE_MOCK) throw notInFixtureMode('Creating event guest codes');
  const { data } = await api.post<EventGuestManifest>(`${B}/codes/event`, input, idem(input.idempotencyKey));
  return data;
}

export async function submitProofOfPayment(): Promise<RestrictionStatus> {
  if (USE_MOCK) throw notInFixtureMode('Submitting proof of payment');
  const { data } = await api.post<RestrictionStatus>(`${B}/restriction/proof`, {}, idem());
  return data;
}

export async function submitAppeal(): Promise<RestrictionStatus> {
  if (USE_MOCK) throw notInFixtureMode('Submitting an appeal');
  const { data } = await api.post<RestrictionStatus>(`${B}/restriction/appeal`, {}, idem());
  return data;
}

/** Reset stores — used by tests to keep runs deterministic (mock mode). */
export function __resetVisitorStore(): void {
  codes = [...seedCodes];
  events = [...seedEvents];
  restriction = { ...seedRestriction };
  gateSession = { ...seedGateSession };
  notifications = [...seedNotifications];
  blacklist = [...seedBlacklist];
  incidents = [...seedIncidents];
}
