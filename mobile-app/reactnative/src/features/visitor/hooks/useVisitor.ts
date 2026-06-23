import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateIdempotencyKey } from '@/utils/idempotency';
import * as api from '../api/visitor.api';
import type {
  CreateAccessCodeInput,
  GuardCapture,
} from '../types/visitor.types';

// Query keys are centralised so invalidation stays consistent across screens.
export const visitorKeys = {
  all: ['visitor'] as const,
  codes: () => [...visitorKeys.all, 'codes'] as const,
  code: (id: string) => [...visitorKeys.all, 'code', id] as const,
  restriction: () => [...visitorKeys.all, 'restriction'] as const,
  history: () => [...visitorKeys.all, 'history'] as const,
  gateSession: () => [...visitorKeys.all, 'gate-session'] as const,
  expected: () => [...visitorKeys.all, 'expected'] as const,
  gateLog: () => [...visitorKeys.all, 'gate-log'] as const,
  pendingSync: () => [...visitorKeys.all, 'pending-sync'] as const,
  openVisits: () => [...visitorKeys.all, 'open-visits'] as const,
  notifications: () => [...visitorKeys.all, 'notifications'] as const,
  unread: () => [...visitorKeys.all, 'unread'] as const,
  blacklist: () => [...visitorKeys.all, 'blacklist'] as const,
  incidents: () => [...visitorKeys.all, 'incidents'] as const,
  analytics: () => [...visitorKeys.all, 'analytics'] as const,
  lookup: (q: string) => [...visitorKeys.all, 'lookup', q] as const,
  vehicles: () => [...visitorKeys.all, 'vehicles'] as const,
  attendance: (id: string) => [...visitorKeys.all, 'attendance', id] as const,
  contacts: (q: string) => [...visitorKeys.all, 'contacts', q] as const,
  overstays: () => [...visitorKeys.all, 'overstays'] as const,
};

// ── Resident ─────────────────────────────────────────────────────────────────
export function useRestrictionStatus() {
  return useQuery({ queryKey: visitorKeys.restriction(), queryFn: api.getRestrictionStatus });
}

export function useAccessCodes() {
  return useQuery({ queryKey: visitorKeys.codes(), queryFn: api.listAccessCodes });
}

export function useAccessCode(id: string) {
  return useQuery({
    queryKey: visitorKeys.code(id),
    queryFn: () => api.getAccessCode(id),
    enabled: !!id,
  });
}

export function useCreateAccessCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateAccessCodeInput, 'idempotencyKey'>) =>
      api.createAccessCode({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: visitorKeys.codes() });
      qc.invalidateQueries({ queryKey: visitorKeys.expected() });
    },
  });
}

export function useRevokeAccessCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.revokeAccessCode(id),
    onSuccess: (code) => {
      qc.invalidateQueries({ queryKey: visitorKeys.codes() });
      qc.invalidateQueries({ queryKey: visitorKeys.code(code.id) });
      qc.invalidateQueries({ queryKey: visitorKeys.expected() });
    },
  });
}

export function useExtendAccessCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; validityEnd: string }) =>
      api.extendAccessCode(vars.id, vars.validityEnd),
    onSuccess: (code) => {
      qc.invalidateQueries({ queryKey: visitorKeys.codes() });
      qc.invalidateQueries({ queryKey: visitorKeys.code(code.id) });
    },
  });
}

export function useVisitHistory() {
  return useQuery({ queryKey: visitorKeys.history(), queryFn: api.listVisitHistory });
}

// ── Guard ────────────────────────────────────────────────────────────────────
export function useGateSession() {
  return useQuery({ queryKey: visitorKeys.gateSession(), queryFn: api.getGateSession });
}

export function useExpectedVisitors() {
  return useQuery({ queryKey: visitorKeys.expected(), queryFn: api.listExpectedVisitors });
}

export function useGateLog() {
  return useQuery({ queryKey: visitorKeys.gateLog(), queryFn: api.listGateLog });
}

export function usePendingSyncCount() {
  return useQuery({ queryKey: visitorKeys.pendingSync(), queryFn: api.pendingSyncCount });
}

export function useSyncPendingLogs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.syncPendingLogs,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: visitorKeys.pendingSync() });
      qc.invalidateQueries({ queryKey: visitorKeys.gateLog() });
      qc.invalidateQueries({ queryKey: visitorKeys.history() });
    },
  });
}

export function useLookupCode() {
  return useMutation({ mutationFn: (raw: string) => api.lookupCode(raw) });
}

export function useApproveEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { accessCodeId: string; gateId: string; capture?: GuardCapture }) =>
      api.approveEntry({ ...vars, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: visitorKeys.gateLog() });
      qc.invalidateQueries({ queryKey: visitorKeys.expected() });
      qc.invalidateQueries({ queryKey: visitorKeys.codes() });
      qc.invalidateQueries({ queryKey: visitorKeys.openVisits() });
      qc.invalidateQueries({ queryKey: visitorKeys.attendance(vars.accessCodeId) });
      qc.invalidateQueries({ queryKey: visitorKeys.notifications() });
      qc.invalidateQueries({ queryKey: visitorKeys.unread() });
    },
  });
}

export function useDenyEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { accessCodeId?: string; codeValue: string; gateId: string; reason: string }) =>
      api.denyEntry({ ...vars, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: visitorKeys.gateLog() });
    },
  });
}

// ── Guard P1: open visits / check-out / walk-in / handover ────────────────────
export function useOpenVisits() {
  return useQuery({ queryKey: visitorKeys.openVisits(), queryFn: api.listOpenVisits });
}

export function useOverstays() {
  return useQuery({ queryKey: visitorKeys.overstays(), queryFn: api.listOverstays });
}

export function useCheckOutVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { visitEventId: string; gateId: string }) =>
      api.checkOutVisit({ ...vars, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: visitorKeys.openVisits() });
      qc.invalidateQueries({ queryKey: visitorKeys.overstays() });
      qc.invalidateQueries({ queryKey: visitorKeys.gateLog() });
      qc.invalidateQueries({ queryKey: visitorKeys.history() });
    },
  });
}

export function useCreateWalkIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { visitorName: string; unitLabel: string; visitorPhone?: string; purpose?: string; emergency: boolean; gateId: string }) =>
      api.createWalkIn({ ...vars, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: visitorKeys.gateLog() });
      qc.invalidateQueries({ queryKey: visitorKeys.openVisits() });
      qc.invalidateQueries({ queryKey: visitorKeys.pendingSync() });
    },
  });
}

export function useSubmitHandover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { gateId: string; notes: string }) =>
      api.submitHandover({ ...vars, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: visitorKeys.gateSession() });
    },
  });
}

// ── Notifications (Section W) ────────────────────────────────────────────────
export function useNotifications() {
  return useQuery({ queryKey: visitorKeys.notifications(), queryFn: api.listNotifications });
}

export function useUnreadCount() {
  return useQuery({ queryKey: visitorKeys.unread(), queryFn: api.unreadNotificationCount });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: visitorKeys.notifications() });
      qc.invalidateQueries({ queryKey: visitorKeys.unread() });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.markAllNotificationsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: visitorKeys.notifications() });
      qc.invalidateQueries({ queryKey: visitorKeys.unread() });
    },
  });
}

// ── Blacklist (VM-241 / 244) ─────────────────────────────────────────────────
export function useBlacklist() {
  return useQuery({ queryKey: visitorKeys.blacklist(), queryFn: api.listBlacklist });
}

export function useAddBlacklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { matchKind: 'phone' | 'id' | 'plate'; matchValue: string; name?: string; reason: string }) =>
      api.addBlacklist({ ...vars, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: visitorKeys.blacklist() }),
  });
}

export function useRemoveBlacklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.removeBlacklist(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: visitorKeys.blacklist() }),
  });
}

// ── Incident / suspicious (VM-242 / 217) ─────────────────────────────────────
export function useIncidents() {
  return useQuery({ queryKey: visitorKeys.incidents(), queryFn: api.listIncidents });
}

export function useSubmitIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { kind: 'suspicious' | 'incident'; severity: 'low' | 'medium' | 'high'; title: string; description: string; gateId: string; escalate: boolean }) =>
      api.submitIncident({ ...vars, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: visitorKeys.incidents() }),
  });
}

// ── Analytics (Section X) ────────────────────────────────────────────────────
export function useVisitorAnalytics() {
  return useQuery({ queryKey: visitorKeys.analytics(), queryFn: api.getVisitorAnalytics });
}

// ── Lookup (VM-204) ──────────────────────────────────────────────────────────
export function useLookup(query: string) {
  return useQuery({
    queryKey: visitorKeys.lookup(query),
    queryFn: () => api.lookupVisitorsAndResidents(query),
    enabled: query.trim().length >= 2,
  });
}

// ── Vehicle entry log (VM-210) ───────────────────────────────────────────────
export function useVehicleEntries() {
  return useQuery({ queryKey: visitorKeys.vehicles(), queryFn: api.listVehicleEntries });
}

// ── Event guest bulk (VM-107) ────────────────────────────────────────────────
export function useCreateEventGuests() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { eventName: string; guestNames: string[]; validityStart: string; validityEnd: string }) =>
      api.createEventGuestCodes({ ...vars, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: visitorKeys.codes() }),
  });
}

// ── Restriction: proof & appeal (§10) ────────────────────────────────────────
export function useSubmitProofOfPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.submitProofOfPayment,
    onSuccess: () => qc.invalidateQueries({ queryKey: visitorKeys.restriction() }),
  });
}

export function useSubmitAppeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.submitAppeal,
    onSuccess: () => qc.invalidateQueries({ queryKey: visitorKeys.restriction() }),
  });
}

// ── Attendance: live check-in/out + phonebook ────────────────────────────────
export function useCodeAttendance(codeId: string, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: visitorKeys.attendance(codeId),
    queryFn: () => api.getCodeAttendance(codeId),
    enabled: !!codeId,
    staleTime: 0,
    // Poll so the resident's code screen reflects gate activity in near-real-time.
    refetchInterval: options?.poll ? 5_000 : false,
  });
}

export function useRecordArrival() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { accessCodeId: string; gateId: string }) => api.recordArrival(vars.accessCodeId, vars.gateId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: visitorKeys.attendance(vars.accessCodeId) });
      qc.invalidateQueries({ queryKey: visitorKeys.notifications() });
      qc.invalidateQueries({ queryKey: visitorKeys.unread() });
      qc.invalidateQueries({ queryKey: visitorKeys.gateLog() });
    },
  });
}

export function useRecordExit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { accessCodeId: string; gateId: string }) =>
      api.recordExit({ ...vars, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: visitorKeys.attendance(vars.accessCodeId) });
      qc.invalidateQueries({ queryKey: visitorKeys.openVisits() });
      qc.invalidateQueries({ queryKey: visitorKeys.gateLog() });
      qc.invalidateQueries({ queryKey: visitorKeys.history() });
      qc.invalidateQueries({ queryKey: visitorKeys.notifications() });
      qc.invalidateQueries({ queryKey: visitorKeys.unread() });
    },
  });
}

export function usePhonebookContacts(query: string) {
  return useQuery({
    queryKey: visitorKeys.contacts(query),
    queryFn: () => api.listPhonebookContacts(query),
  });
}
