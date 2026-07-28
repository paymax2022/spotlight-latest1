// ── Association — Settings & Support hooks (V/W) ──────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getNotificationPrefs, updateNotificationPrefs,
  getSecuritySettings, updateSecuritySettings,
  getDevices, revokeDevice,
  getPreferences, updatePreferences,
  getFaqs, getTickets, getTicket, createTicket, replyTicket,
} from '../api/settings.api';
import type { NotificationPrefs, SecuritySettings, Preferences, CreateTicketInput, SupportTicket } from '../types/settings.types';

const KEY = 'association';

// ─── Settings ────────────────────────────────────────────────────
export function useNotificationPrefs() {
  return useQuery({ queryKey: [KEY, 'notifPrefs'], queryFn: getNotificationPrefs, staleTime: 30_000 });
}
export function useUpdateNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (next: NotificationPrefs) => updateNotificationPrefs(next),
    onSuccess: (data) => qc.setQueryData([KEY, 'notifPrefs'], data),
  });
}
export function useSecuritySettings() {
  return useQuery({ queryKey: [KEY, 'security'], queryFn: getSecuritySettings, staleTime: 30_000 });
}
export function useUpdateSecuritySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (next: SecuritySettings) => updateSecuritySettings(next),
    onSuccess: (data) => qc.setQueryData([KEY, 'security'], data),
  });
}
export function useDevices() {
  return useQuery({ queryKey: [KEY, 'devices'], queryFn: getDevices, staleTime: 30_000 });
}
export function useRevokeDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeDevice(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'devices'] }),
  });
}

export function usePreferences() {
  return useQuery({ queryKey: [KEY, 'preferences'], queryFn: getPreferences, staleTime: 60_000 });
}
export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (next: Preferences) => updatePreferences(next),
    onSuccess: (data) => qc.setQueryData([KEY, 'preferences'], data),
  });
}

// ─── Support ─────────────────────────────────────────────────────
export function useFaqs() {
  return useQuery({ queryKey: [KEY, 'faqs'], queryFn: getFaqs, staleTime: 5 * 60_000 });
}
export function useTickets() {
  return useQuery({ queryKey: [KEY, 'tickets'], queryFn: getTickets, staleTime: 20_000 });
}
export function useTicket(id?: string) {
  return useQuery({
    queryKey: [KEY, 'ticket', id],
    queryFn: () => getTicket(id as string),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}
export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTicketInput) => createTicket(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'tickets'] }),
  });
}
export function useReplyTicket(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => replyTicket(id, body),
    onSuccess: (msg) => {
      qc.setQueryData<SupportTicket>([KEY, 'ticket', id], (prev) =>
        prev ? { ...prev, messages: [...prev.messages, msg] } : prev,
      );
    },
  });
}
