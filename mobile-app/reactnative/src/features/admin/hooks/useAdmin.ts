// ── Paymax · Admin Console — Data hooks ──────────────────────────────────────
// React Query hooks mirroring useCrypto.ts so admin screens stay declarative and
// share the same caching / loading / error contracts. Mutations invalidate the
// relevant query keys (and the dashboard, whose KPIs depend on most of them).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as admin from '../api/admin.api';
import type {
  AssetControlPatch,
  KycDecision,
  OrderFilter,
  WithdrawalDecision,
} from '../types/admin.types';

const KEY = 'admin';

// ─── Dashboard ──────────────────────────────────────────────────────────────--

export function useDashboard() {
  return useQuery({ queryKey: [KEY, 'dashboard'], queryFn: admin.getDashboard, staleTime: 30_000 });
}

// ─── Users ──────────────────────────────────────────────────────────────────--

export function useAdminUsers() {
  return useQuery({ queryKey: [KEY, 'users'], queryFn: admin.getUsers, staleTime: 30_000 });
}

export function useAdminUser(id?: string) {
  return useQuery({
    queryKey: [KEY, 'user', id],
    queryFn: () => admin.getUser(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

// ─── KYC ────────────────────────────────────────────────────────────────────--

export function useKycQueue() {
  return useQuery({ queryKey: [KEY, 'kyc'], queryFn: admin.getKycQueue, staleTime: 15_000 });
}

export function useReviewKyc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, reason }: { id: string; decision: KycDecision; reason: string }) =>
      admin.reviewKyc(id, decision, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'kyc'] });
      qc.invalidateQueries({ queryKey: [KEY, 'dashboard'] });
      qc.invalidateQueries({ queryKey: [KEY, 'audit'] });
    },
  });
}

// ─── Asset controls ────────────────────────────────────────────────────────--

export function useAssetControls() {
  return useQuery({ queryKey: [KEY, 'assets'], queryFn: admin.getAssetControls, staleTime: 20_000 });
}

export function useUpdateAssetControl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AssetControlPatch }) =>
      admin.updateAssetControl(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'assets'] });
      qc.invalidateQueries({ queryKey: [KEY, 'audit'] });
    },
  });
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export function useAdminOrders(filter: OrderFilter = 'all') {
  return useQuery({
    queryKey: [KEY, 'orders', filter],
    queryFn: () => admin.getOrders(filter),
    staleTime: 15_000,
  });
}

// ─── Withdrawal review ─────────────────────────────────────────────────────--

export function useWithdrawalQueue() {
  return useQuery({ queryKey: [KEY, 'withdrawals'], queryFn: admin.getWithdrawalQueue, staleTime: 15_000 });
}

export function useReviewWithdrawal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ref, decision, reason }: { ref: string; decision: WithdrawalDecision; reason: string }) =>
      admin.reviewWithdrawal(ref, decision, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'withdrawals'] });
      qc.invalidateQueries({ queryKey: [KEY, 'dashboard'] });
      qc.invalidateQueries({ queryKey: [KEY, 'audit'] });
    },
  });
}

// ─── Reconciliation ───────────────────────────────────────────────────────────

export function useReconciliation() {
  return useQuery({ queryKey: [KEY, 'reconciliation'], queryFn: admin.getReconciliation, staleTime: 30_000 });
}

// ─── Providers ─────────────────────────────────────────────────────────────--

export function useProviders() {
  return useQuery({
    queryKey: [KEY, 'providers'],
    queryFn: admin.getProviders,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

// ─── Risk limits ──────────────────────────────────────────────────────────────

export function useRiskLimits() {
  return useQuery({ queryKey: [KEY, 'risk-limits'], queryFn: admin.getRiskLimits, staleTime: 30_000 });
}

export function useUpdateRiskLimit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, valueMinor }: { id: string; valueMinor: number }) =>
      admin.updateRiskLimit(id, valueMinor),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'risk-limits'] });
      qc.invalidateQueries({ queryKey: [KEY, 'audit'] });
    },
  });
}

// ─── Fees ─────────────────────────────────────────────────────────────────────

export function useFees() {
  return useQuery({ queryKey: [KEY, 'fees'], queryFn: admin.getFees, staleTime: 30_000 });
}

export function useUpdateFee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, bps }: { id: string; bps: number }) => admin.updateFee(id, bps),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'fees'] });
      qc.invalidateQueries({ queryKey: [KEY, 'audit'] });
    },
  });
}

// ─── Feature flags ─────────────────────────────────────────────────────────--

export function useFeatureFlags() {
  return useQuery({ queryKey: [KEY, 'feature-flags'], queryFn: admin.getFeatureFlags, staleTime: 30_000 });
}

export function useSetFeatureFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      admin.setFeatureFlag(key, enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'feature-flags'] });
      qc.invalidateQueries({ queryKey: [KEY, 'audit'] });
    },
  });
}

// ─── Approvals (maker-checker) ─────────────────────────────────────────────--

export function useApprovals() {
  return useQuery({ queryKey: [KEY, 'approvals'], queryFn: admin.getApprovals, staleTime: 15_000 });
}

export function useApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => admin.approve(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'approvals'] });
      qc.invalidateQueries({ queryKey: [KEY, 'audit'] });
    },
  });
}

export function useRejectApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => admin.rejectApproval(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'approvals'] });
      qc.invalidateQueries({ queryKey: [KEY, 'audit'] });
    },
  });
}

// ─── Audit log ─────────────────────────────────────────────────────────────--

export function useAudit() {
  return useQuery({ queryKey: [KEY, 'audit'], queryFn: admin.getAudit, staleTime: 15_000 });
}

// ─── Admin directory ─────────────────────────────────────────────────────────-

export function useAdmins() {
  return useQuery({ queryKey: [KEY, 'admins'], queryFn: admin.getAdmins, staleTime: 30_000 });
}
