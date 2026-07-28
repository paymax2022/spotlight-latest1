// ── FX Exchange — Data hooks ─────────────────────────────────────────────────
// React Query hooks mirroring useCrowdfunding.ts so screens stay declarative and
// share caching / loading / error contracts.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as fx from '../api/fx.api';
import type {
  QuoteRequest,
  Quote,
  Beneficiary,
  NewBeneficiaryDraft,
  SendDraft,
  TransactionFilter,
  RateRange,
  VirtualAccountType,
  CurrencyCode,
  NewRateAlertDraft,
} from '../types/fx.types';
import { newIdempotencyKey } from '../utils/fxFormatters';

const KEY = 'fx';

// ─── Balances & rates ──────────────────────────────────────────────────────────

export function useBalances() {
  return useQuery({ queryKey: [KEY, 'balances'], queryFn: fx.getBalances, staleTime: 20_000 });
}

export function useAddWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (currency: CurrencyCode) => fx.addWallet(currency),
    onSettled: () => qc.invalidateQueries({ queryKey: [KEY, 'balances'] }),
  });
}

export function useRates() {
  return useQuery({ queryKey: [KEY, 'rates'], queryFn: fx.getRates, staleTime: 30_000, refetchInterval: 30_000 });
}

export function useRateHistory(from: CurrencyCode, to: CurrencyCode, range: RateRange) {
  return useQuery({
    queryKey: [KEY, 'rate-history', from, to, range],
    queryFn: () => fx.getRateHistory(from, to, range),
    staleTime: 60_000,
  });
}

// ─── Quotes ─────────────────────────────────────────────────────────────────────

export function useCreateQuote() {
  return useMutation({ mutationFn: (req: QuoteRequest) => fx.createQuote(req) });
}

export function useLockQuote() {
  return useMutation({ mutationFn: ({ quoteId, req }: { quoteId: string; req: QuoteRequest }) => fx.lockQuote(quoteId, req) });
}

// ─── Conversions & transfers (money mutations → Idempotency-Key) ──────────────

export function useExecuteConversion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quote: Quote) => fx.executeConversion(quote, newIdempotencyKey('cv')),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'balances'] });
      qc.invalidateQueries({ queryKey: [KEY, 'transactions'] });
    },
  });
}

export function useExecuteTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ draft, quote, beneficiary }: { draft: SendDraft; quote: Quote; beneficiary: Beneficiary }) =>
      fx.executeTransfer(draft, quote, beneficiary, newIdempotencyKey('tr')),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'balances'] });
      qc.invalidateQueries({ queryKey: [KEY, 'transactions'] });
    },
  });
}

export function useTransfer(reference?: string) {
  return useQuery({
    queryKey: [KEY, 'transfer', reference],
    queryFn: () => fx.getTransfer(reference as string),
    enabled: Boolean(reference),
  });
}

// ─── Beneficiaries ────────────────────────────────────────────────────────────

export function useBeneficiaries() {
  return useQuery({ queryKey: [KEY, 'beneficiaries'], queryFn: fx.getBeneficiaries, staleTime: 30_000 });
}

export function useValidateBeneficiary() {
  return useMutation({ mutationFn: (draft: NewBeneficiaryDraft) => fx.validateBeneficiary(draft) });
}

export function useCreateBeneficiary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: NewBeneficiaryDraft) => fx.createBeneficiary(draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'beneficiaries'] }),
  });
}

export function useUpdateBeneficiary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: NewBeneficiaryDraft }) => fx.updateBeneficiary(id, draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'beneficiaries'] }),
  });
}

export function useToggleFavoriteBeneficiary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) => fx.toggleFavoriteBeneficiary(id, favorite),
    onSettled: () => qc.invalidateQueries({ queryKey: [KEY, 'beneficiaries'] }),
  });
}

export function useDeleteBeneficiary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fx.deleteBeneficiary(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'beneficiaries'] }),
  });
}

// ─── Collections ──────────────────────────────────────────────────────────────

export function useVirtualAccounts() {
  return useQuery({ queryKey: [KEY, 'virtual-accounts'], queryFn: fx.getVirtualAccounts, staleTime: 30_000 });
}

export function useCreateVirtualAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ currency, type }: { currency: CurrencyCode; type: VirtualAccountType }) =>
      fx.createVirtualAccount(currency, type, newIdempotencyKey('va')),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'virtual-accounts'] }),
  });
}

export function useCollections() {
  return useQuery({ queryKey: [KEY, 'collections'], queryFn: fx.getCollections, staleTime: 20_000 });
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export function useTransactions(filter?: TransactionFilter) {
  return useQuery({
    queryKey: [KEY, 'transactions', filter ?? {}],
    queryFn: () => fx.getTransactions(filter),
    staleTime: 15_000,
  });
}

export function useDisputeTransaction() {
  return useMutation({ mutationFn: (draft: import('../types/fx.types').DisputeDraft) => fx.disputeTransaction(draft) });
}

export function useTransaction(id?: string) {
  return useQuery({
    queryKey: [KEY, 'transaction', id],
    queryFn: () => fx.getTransaction(id as string),
    enabled: Boolean(id),
  });
}

// ─── Rate alerts ────────────────────────────────────────────────────────────────

export function useRateAlerts() {
  return useQuery({ queryKey: [KEY, 'rate-alerts'], queryFn: fx.getRateAlerts, staleTime: 30_000 });
}

export function useCreateRateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: NewRateAlertDraft) => fx.createRateAlert(draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'rate-alerts'] }),
  });
}

export function useDeleteRateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fx.deleteRateAlert(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'rate-alerts'] }),
  });
}
