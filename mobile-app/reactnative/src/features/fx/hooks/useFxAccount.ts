// ── FX Exchange — Account hooks (business, notifications, settings) ───────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as acc from '../api/fxAccount.api';
import type { TeamRole, NotificationPrefs, StablecoinAddress, FxSettings } from '../types/fx.types';

const KEY = 'fx-account';

// Business
export function useTeam() { return useQuery({ queryKey: [KEY, 'team'], queryFn: acc.getTeam, staleTime: 30_000 }); }
export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, role }: { id: string; role: TeamRole }) => acc.updateMemberRole(id, role), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'team'] }) });
}
export function useApprovals() { return useQuery({ queryKey: [KEY, 'approvals'], queryFn: acc.getApprovals, staleTime: 15_000 }); }
export function useDecideApproval() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, decision }: { id: string; decision: 'APPROVED' | 'REJECTED' }) => acc.decideApproval(id, decision), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'approvals'] }) });
}
export function useThresholds() { return useQuery({ queryKey: [KEY, 'thresholds'], queryFn: acc.getThresholds, staleTime: 30_000 }); }
export function useUpdateThreshold() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, amount, approversRequired }: { id: string; amount: number; approversRequired: number }) => acc.updateThreshold(id, amount, approversRequired), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'thresholds'] }) });
}
export function useActivity() { return useQuery({ queryKey: [KEY, 'activity'], queryFn: acc.getActivity, staleTime: 30_000 }); }
export function useApiKeys() { return useQuery({ queryKey: [KEY, 'api-keys'], queryFn: acc.getApiKeys, staleTime: 30_000 }); }
export function useRotateApiKey() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => acc.rotateApiKey(id), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'api-keys'] }) });
}
export function useWebhookSettings() { return useQuery({ queryKey: [KEY, 'webhooks'], queryFn: acc.getWebhookSettings, staleTime: 30_000 }); }
export function useToggleWebhook() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => acc.toggleWebhook(id, enabled), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'webhooks'] }) });
}

// Notifications
export function useNotifications() { return useQuery({ queryKey: [KEY, 'notifications'], queryFn: acc.getNotifications, staleTime: 15_000 }); }
export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => acc.markNotificationRead(id), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'notifications'] }) });
}
export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => acc.markAllNotificationsRead(), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'notifications'] }) });
}

// Settings
export function useSettings() { return useQuery({ queryKey: [KEY, 'settings'], queryFn: acc.getSettings, staleTime: 30_000 }); }
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (patch: Partial<FxSettings>) => acc.updateSettings(patch), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'settings'] }) });
}
export function useUpdateNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (prefs: NotificationPrefs) => acc.updateNotificationPrefs(prefs), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'settings'] }) });
}
export function useAddStablecoinAddress() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (addr: Omit<StablecoinAddress, 'id'>) => acc.addStablecoinAddress(addr), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'settings'] }) });
}
export function useRemoveStablecoinAddress() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => acc.removeStablecoinAddress(id), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'settings'] }) });
}
export function useTierLimits() { return useQuery({ queryKey: [KEY, 'limits'], queryFn: acc.getTierLimits, staleTime: 30_000 }); }
