// ── Doctor — Earnings, Wallet & Payout hooks (Batch 6, Section Y) ────────────
// Query keys under ['doctor', 'wallet', …] and ['doctor', 'earnings', …].
// Mutations auto-generate the idempotencyKey. REUSES the Phase 1 useEarnings /
// useRequestPayout (useEarnings.ts) for the headline summary + simple payout and
// the Phase 2 usePayoutReport (useReputation.ts) for the period report; this file
// adds the earnings breakdown, wallet balance, payout details, invoices,
// commission breakdown, tax/VAT report and settlement disputes. Hook names are
// distinct from useEarnings to avoid a barrel collision. All money is kobo.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getEarningsBreakdown,
  getWalletBalance,
  getPayoutDetails,
  getPayoutDetail,
  getInvoices,
  getCommissionBreakdown,
  getTaxVatReport,
  getSettlementDisputes,
  withdrawEarnings,
  updatePayoutBankAccount,
  raiseSettlementDispute,
  DEMO_EARNINGS_BREAKDOWN,
  DEMO_WALLET_BALANCE,
  DEMO_PAYOUT_DETAILS,
  DEMO_INVOICES,
  DEMO_COMMISSION_BREAKDOWN,
  DEMO_TAX_VAT_REPORT,
  DEMO_SETTLEMENT_DISPUTES,
} from '@/api/doctor.batch6.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  WithdrawEarningsInput,
  UpdatePayoutBankAccountInput,
  RaiseSettlementDisputeInput,
} from '@/types/doctor.batch6';

// ─── Reads ────────────────────────────────────────────────────────────────────

export function useEarningsBreakdown() {
  return useQuery({
    queryKey:        ['doctor', 'earnings', 'breakdown'],
    queryFn:         getEarningsBreakdown,
    placeholderData: DEMO_EARNINGS_BREAKDOWN,
    staleTime:       30_000,
  });
}

export function useWalletBalance() {
  return useQuery({
    queryKey:        ['doctor', 'wallet', 'balance'],
    queryFn:         getWalletBalance,
    placeholderData: DEMO_WALLET_BALANCE,
    staleTime:       30_000,
  });
}

export function usePayoutDetails() {
  return useQuery({
    queryKey:        ['doctor', 'wallet', 'payout-details'],
    queryFn:         getPayoutDetails,
    placeholderData: DEMO_PAYOUT_DETAILS,
    staleTime:       30_000,
  });
}

export function usePayoutDetail(id: string) {
  return useQuery({
    queryKey:        ['doctor', 'wallet', 'payout-detail', id],
    queryFn:         () => getPayoutDetail(id),
    enabled:         !!id,
    placeholderData: DEMO_PAYOUT_DETAILS.find((p) => p.id === id),
    staleTime:       30_000,
  });
}

export function useInvoices() {
  return useQuery({
    queryKey:        ['doctor', 'wallet', 'invoices'],
    queryFn:         getInvoices,
    placeholderData: DEMO_INVOICES,
    staleTime:       30_000,
  });
}

export function useCommissionBreakdown(rangeLabel?: string) {
  return useQuery({
    queryKey:        ['doctor', 'wallet', 'commission', rangeLabel],
    queryFn:         () => getCommissionBreakdown(rangeLabel),
    placeholderData: DEMO_COMMISSION_BREAKDOWN,
    staleTime:       60_000,
  });
}

export function useTaxVatReport(rangeLabel?: string) {
  return useQuery({
    queryKey:        ['doctor', 'wallet', 'tax-vat', rangeLabel],
    queryFn:         () => getTaxVatReport(rangeLabel),
    placeholderData: DEMO_TAX_VAT_REPORT,
    staleTime:       60_000,
  });
}

export function useSettlementDisputes() {
  return useQuery({
    queryKey:        ['doctor', 'wallet', 'disputes'],
    queryFn:         getSettlementDisputes,
    placeholderData: DEMO_SETTLEMENT_DISPUTES,
    staleTime:       30_000,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useWithdrawEarnings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<WithdrawEarningsInput, 'idempotencyKey'>) =>
      withdrawEarnings({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'wallet'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'earnings'] });
    },
  });
}

export function useUpdatePayoutBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<UpdatePayoutBankAccountInput, 'idempotencyKey'>) =>
      updatePayoutBankAccount({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'wallet'] });
    },
  });
}

export function useRaiseSettlementDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RaiseSettlementDisputeInput, 'idempotencyKey'>) =>
      raiseSettlementDispute({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'wallet', 'disputes'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'wallet', 'payout-details'] });
    },
  });
}
