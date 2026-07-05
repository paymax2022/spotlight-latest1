// ── Referral Earnings & Rewards React Query hooks (v5) ───────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as earningsApi from './api';
import { referralKeys } from '../foundation/hooks';
import { homeKeys } from '../home/hooks';
import type { RewardCurrency, StatementPeriod, AppealInput } from './types';

export const earningsKeys = {
  ledger: () => [...referralKeys.all, 'earnings', 'ledger'] as const,
  reward: (id: string) => [...referralKeys.all, 'earnings', 'reward', id] as const,
  vesting: (id?: string) => [...referralKeys.all, 'earnings', 'vesting', id ?? 'active'] as const,
  withdrawQuote: () => [...referralKeys.all, 'earnings', 'withdraw-quote'] as const,
  currencies: () => [...referralKeys.all, 'earnings', 'currencies'] as const,
  catalog: () => [...referralKeys.all, 'earnings', 'catalog'] as const,
  statement: (p: StatementPeriod) => [...referralKeys.all, 'earnings', 'statement', p] as const,
  clawback: (id?: string) => [...referralKeys.all, 'earnings', 'clawback', id ?? 'latest'] as const,
};

export function useLedger() {
  return useQuery({ queryKey: earningsKeys.ledger(), queryFn: earningsApi.getLedger, staleTime: 30_000 });
}

export function useRewardDetail(id: string) {
  return useQuery({
    queryKey: earningsKeys.reward(id),
    queryFn: () => earningsApi.getRewardDetail(id),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useVestingSchedule(id?: string) {
  return useQuery({
    queryKey: earningsKeys.vesting(id),
    queryFn: () => earningsApi.getVestingSchedule(id),
    staleTime: 30_000,
  });
}

export function useWithdrawQuote() {
  return useQuery({ queryKey: earningsKeys.withdrawQuote(), queryFn: earningsApi.getWithdrawQuote, staleTime: 15_000 });
}

export function useWithdraw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountKobo: number) => earningsApi.withdraw(amountKobo),
    onSuccess: (res) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: earningsKeys.withdrawQuote() });
        qc.invalidateQueries({ queryKey: earningsKeys.ledger() });
        qc.invalidateQueries({ queryKey: homeKeys.dashboard() });
      }
    },
  });
}

export function useCurrencyOptions() {
  return useQuery({ queryKey: earningsKeys.currencies(), queryFn: earningsApi.getCurrencyOptions, staleTime: 5 * 60_000 });
}

export function useSetRewardCurrency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: RewardCurrency) => earningsApi.setRewardCurrency(key),
    onSuccess: (data) => qc.setQueryData(earningsKeys.currencies(), data),
  });
}

export function useCatalog() {
  return useQuery({ queryKey: earningsKeys.catalog(), queryFn: earningsApi.getCatalog, staleTime: 5 * 60_000 });
}

export function useRedeemCatalogItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => earningsApi.redeemCatalogItem(id),
    onSuccess: (res) => {
      if (res.ok) qc.invalidateQueries({ queryKey: earningsKeys.catalog() });
    },
  });
}

export function useStatement(period: StatementPeriod) {
  return useQuery({
    queryKey: earningsKeys.statement(period),
    queryFn: () => earningsApi.getStatement(period),
    staleTime: 60_000,
  });
}

export function useExportStatement() {
  return useMutation({
    mutationFn: (v: { period: StatementPeriod; format: 'pdf' | 'csv' }) =>
      earningsApi.exportStatement(v.period, v.format),
  });
}

export function useClawbackNotice(id?: string) {
  return useQuery({
    queryKey: earningsKeys.clawback(id),
    queryFn: () => earningsApi.getClawbackNotice(id),
    staleTime: 60_000,
  });
}

export function useAppealClawback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AppealInput) => earningsApi.appealClawback(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: earningsKeys.clawback() }),
  });
}
