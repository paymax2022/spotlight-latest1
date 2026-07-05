// ── Paymax Invest · Settings — Data hooks ────────────────────────────────────
// React Query hooks mirroring useCrypto.ts so screens stay declarative and share
// the same caching / loading / error contracts. Mutations invalidate their list
// query on success so the UI reflects the new state without a manual refetch.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as settings from '../api/settings.api';
import type { NewBankDraft, NewTicketDraft } from '../types/settings.types';

const KEY = 'invest-settings';

// ─── Profile ──────────────────────────────────────────────────────────────────

export function useInvestProfile() {
  return useQuery({ queryKey: [KEY, 'profile'], queryFn: settings.getProfile, staleTime: 60_000 });
}

// ─── Linked banks ──────────────────────────────────────────────────────────────

export function useLinkedBanks() {
  return useQuery({ queryKey: [KEY, 'banks'], queryFn: settings.getLinkedBanks, staleTime: 30_000 });
}

export function useAddBank() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: NewBankDraft) => settings.addBank(draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'banks'] }),
  });
}

export function useRemoveBank() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => settings.removeBank(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'banks'] }),
  });
}

// ─── Fee schedule ──────────────────────────────────────────────────────────────

export function useFeeSchedule() {
  return useQuery({ queryKey: [KEY, 'fees'], queryFn: settings.getFeeSchedule, staleTime: 5 * 60_000 });
}

// ─── Statements ────────────────────────────────────────────────────────────────

export function useStatements() {
  return useQuery({ queryKey: [KEY, 'statements'], queryFn: settings.getStatements, staleTime: 60_000 });
}

export function useExportStatement() {
  return useMutation({ mutationFn: (id: string) => settings.exportStatement(id) });
}

// ─── Devices / sessions ──────────────────────────────────────────────────────--

export function useDevices() {
  return useQuery({ queryKey: [KEY, 'devices'], queryFn: settings.getDevices, staleTime: 30_000 });
}

export function useRevokeDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => settings.revokeDevice(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'devices'] }),
  });
}

// ─── Security · change PIN ───────────────────────────────────────────────────--

export function useChangePin() {
  return useMutation({
    mutationFn: ({ oldPin, newPin }: { oldPin: string; newPin: string }) =>
      settings.changePin(oldPin, newPin),
  });
}

// ─── Support tickets ───────────────────────────────────────────────────────────

export function useTickets() {
  return useQuery({ queryKey: [KEY, 'tickets'], queryFn: settings.getTickets, staleTime: 30_000 });
}

export function useTicket(id?: string) {
  return useQuery({
    queryKey: [KEY, 'ticket', id],
    queryFn: () => settings.getTicket(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: NewTicketDraft) => settings.createTicket(draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'tickets'] }),
  });
}
