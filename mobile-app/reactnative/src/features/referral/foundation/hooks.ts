// ── Referral foundation React Query hooks (v5) ───────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as foundationApi from './api';
import type { ConsentKind, AbuseReport } from './api';
import type { NotificationPrefs, ReferralRole } from './types';

export const referralKeys = {
  all: ['referral'] as const,
  attribution: () => [...referralKeys.all, 'attribution'] as const,
  roles: () => [...referralKeys.all, 'roles'] as const,
  notifications: () => [...referralKeys.all, 'notifications'] as const,
  notificationPrefs: () => [...referralKeys.all, 'notification-prefs'] as const,
  standing: () => [...referralKeys.all, 'standing'] as const,
  consent: () => [...referralKeys.all, 'consent'] as const,
};

// ── Attribution / codes ──────────────────────────────────────────────────────
export function useAttribution() {
  return useQuery({
    queryKey: referralKeys.attribution(),
    queryFn: foundationApi.getAttribution,
    staleTime: 30_000,
  });
}

export function useResolveCode() {
  return useMutation({ mutationFn: (code: string) => foundationApi.resolveCode(code) });
}

export function useAttributeSignup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => foundationApi.attributeSignup(code),
    onSuccess: () => qc.invalidateQueries({ queryKey: referralKeys.attribution() }),
  });
}

export function useClaimCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => foundationApi.claimCode(code),
    onSuccess: () => qc.invalidateQueries({ queryKey: referralKeys.attribution() }),
  });
}

// ── Roles / context ──────────────────────────────────────────────────────────
export function useRoleContext() {
  return useQuery({
    queryKey: referralKeys.roles(),
    queryFn: foundationApi.getRoleContext,
    staleTime: 5 * 60_000,
  });
}

export function useSetActiveRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (role: ReferralRole) => foundationApi.setActiveRole(role),
    onSuccess: (data) => qc.setQueryData(referralKeys.roles(), data),
  });
}

// ── Notifications ────────────────────────────────────────────────────────────
export function useReferralNotifications() {
  return useQuery({
    queryKey: referralKeys.notifications(),
    queryFn: foundationApi.getNotifications,
    staleTime: 30_000,
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: foundationApi.markNotificationsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: referralKeys.notifications() }),
  });
}

export function useNotificationPrefs() {
  return useQuery({
    queryKey: referralKeys.notificationPrefs(),
    queryFn: foundationApi.getNotificationPrefs,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: NotificationPrefs) => foundationApi.updateNotificationPrefs(prefs),
    onSuccess: (data) => qc.setQueryData(referralKeys.notificationPrefs(), data),
  });
}

// ── Account / fraud standing ─────────────────────────────────────────────────
export function useStanding() {
  return useQuery({
    queryKey: referralKeys.standing(),
    queryFn: foundationApi.getStanding,
    staleTime: 30_000,
  });
}

export function useReportAbuse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (report: AbuseReport) => foundationApi.reportAbuse(report),
    onSuccess: () => qc.invalidateQueries({ queryKey: referralKeys.standing() }),
  });
}

// ── Consent ──────────────────────────────────────────────────────────────────
export function useConsent() {
  return useQuery({
    queryKey: referralKeys.consent(),
    queryFn: foundationApi.getConsent,
    staleTime: 60_000,
  });
}

export function useRecordConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { kind: ConsentKind; granted: boolean }) => foundationApi.recordConsent(v.kind, v.granted),
    onSuccess: (data) => qc.setQueryData(referralKeys.consent(), data),
  });
}
