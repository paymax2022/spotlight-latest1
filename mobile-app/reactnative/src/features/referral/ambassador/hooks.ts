// ── Referral Ambassador Zone React Query hooks (v5) — M-AMB-01..06 ───────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ambApi from './api';
import { referralKeys } from '../foundation/hooks';

export const ambassadorKeys = {
  dashboard: () => [...referralKeys.all, 'ambassador', 'dashboard'] as const,
  creatives: () => [...referralKeys.all, 'ambassador', 'creatives'] as const,
  audience: () => [...referralKeys.all, 'ambassador', 'audience'] as const,
  analytics: () => [...referralKeys.all, 'ambassador', 'analytics'] as const,
  payouts: () => [...referralKeys.all, 'ambassador', 'payouts'] as const,
  tiers: () => [...referralKeys.all, 'ambassador', 'tiers'] as const,
  application: () => [...referralKeys.all, 'ambassador', 'application'] as const,
};

export function useAmbassadorDashboard() {
  return useQuery({ queryKey: ambassadorKeys.dashboard(), queryFn: ambApi.getDashboard, staleTime: 30_000 });
}

export function useCreativeAssets() {
  return useQuery({ queryKey: ambassadorKeys.creatives(), queryFn: ambApi.getCreativeAssets, staleTime: 5 * 60_000 });
}

export function useAudience() {
  return useQuery({ queryKey: ambassadorKeys.audience(), queryFn: ambApi.getAudience, staleTime: 30_000 });
}

export function useAmbassadorAnalytics() {
  return useQuery({ queryKey: ambassadorKeys.analytics(), queryFn: ambApi.getAnalytics, staleTime: 60_000 });
}

export function useAmbassadorPayouts() {
  return useQuery({ queryKey: ambassadorKeys.payouts(), queryFn: ambApi.getPayouts, staleTime: 30_000 });
}

export function useWithdrawAmbassadorPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountKobo: number) => ambApi.withdrawPayout(amountKobo),
    onSuccess: (res) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: ambassadorKeys.payouts() });
        qc.invalidateQueries({ queryKey: ambassadorKeys.dashboard() });
      }
    },
  });
}

export function useTierProgression() {
  return useQuery({ queryKey: ambassadorKeys.tiers(), queryFn: ambApi.getTierProgression, staleTime: 60_000 });
}

// ── Application (M-AMB-00) ───────────────────────────────────────────────────

/** The caller's ambassador record, or null when they have never applied. */
export function useMyAmbassadorApplication() {
  return useQuery({
    queryKey: ambassadorKeys.application(),
    queryFn: ambApi.getMyApplication,
    staleTime: 30_000,
  });
}

export function useApplyAsAmbassador() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ambApi.applyAsAmbassador,
    onSuccess: () => {
      // The application drives what the whole ambassador zone shows, so refresh
      // the record and the dashboard that keys off its tier.
      void qc.invalidateQueries({ queryKey: ambassadorKeys.application() });
      void qc.invalidateQueries({ queryKey: ambassadorKeys.dashboard() });
    },
  });
}
