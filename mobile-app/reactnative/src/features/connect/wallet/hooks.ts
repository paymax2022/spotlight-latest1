// Paymax Connect — Wallet / Gifting / Tier-KYC / Payout React Query hooks (v5).
// Mutations invalidate the wallet summary + history + tier so the projected
// balance and remaining allowance refresh after every money move.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as walletApi from './api';
import type { SendGiftInput, Tier1Input, Tier2Input, Tier3Input, PayoutRequestInput } from './types';

export const walletKeys = {
  all: ['connect', 'wallet'] as const,
  summary: () => [...walletKeys.all, 'summary'] as const,
  tier: () => [...walletKeys.all, 'tier'] as const,
  history: () => [...walletKeys.all, 'history'] as const,
  entry: (id: string) => [...walletKeys.all, 'entry', id] as const,
  giftCatalog: () => [...walletKeys.all, 'gift-catalog'] as const,
  giftProduct: (id: string) => [...walletKeys.all, 'gift-product', id] as const,
  giftRecipients: (q?: string) => [...walletKeys.all, 'gift-recipients', q ?? ''] as const,
  giftQuote: (productId: string, recipientId: string) =>
    [...walletKeys.all, 'gift-quote', productId, recipientId] as const,
  sentGifts: () => [...walletKeys.all, 'gifts-sent'] as const,
  receivedGifts: () => [...walletKeys.all, 'gifts-received'] as const,
  giftTx: (id: string) => [...walletKeys.all, 'gift-tx', id] as const,
  kyc: () => [...walletKeys.all, 'kyc'] as const,
  tierLimits: () => [...walletKeys.all, 'tier-limits'] as const,
  payoutEligibility: () => [...walletKeys.all, 'payout-eligibility'] as const,
  payoutHistory: () => [...walletKeys.all, 'payout-history'] as const,
};

// ── Wallet ───────────────────────────────────────────────────────────────────

export function useWalletSummary() {
  return useQuery({ queryKey: walletKeys.summary(), queryFn: walletApi.getWalletSummary });
}

export function useTierStatus() {
  return useQuery({ queryKey: walletKeys.tier(), queryFn: walletApi.getTierStatus });
}

export function useWalletHistory() {
  return useQuery({ queryKey: walletKeys.history(), queryFn: () => walletApi.getWalletHistory() });
}

export function useWalletEntry(id: string) {
  return useQuery({
    queryKey: walletKeys.entry(id),
    queryFn: () => walletApi.getWalletEntry(id),
    enabled: !!id,
  });
}

export function useFundWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountKobo: number) => walletApi.fundWallet(amountKobo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: walletKeys.summary() });
      qc.invalidateQueries({ queryKey: walletKeys.history() });
      qc.invalidateQueries({ queryKey: walletKeys.tier() });
    },
  });
}

// ── Gifting ────────────────────────────────────────────────────────────────────

export function useGiftCatalog() {
  return useQuery({ queryKey: walletKeys.giftCatalog(), queryFn: walletApi.getGiftCatalog });
}

export function useGiftProduct(id: string) {
  return useQuery({
    queryKey: walletKeys.giftProduct(id),
    queryFn: () => walletApi.getGiftProduct(id),
    enabled: !!id,
  });
}

export function useGiftRecipients(query?: string) {
  return useQuery({
    queryKey: walletKeys.giftRecipients(query),
    queryFn: () => walletApi.getGiftRecipients(query),
  });
}

export function useGiftQuote(productId?: string, recipientId?: string) {
  return useQuery({
    queryKey: walletKeys.giftQuote(productId ?? '', recipientId ?? ''),
    queryFn: () => walletApi.quoteGift(productId as string, recipientId as string),
    enabled: !!productId && !!recipientId,
  });
}

export function useSendGift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendGiftInput) => walletApi.sendGift(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: walletKeys.summary() });
      qc.invalidateQueries({ queryKey: walletKeys.history() });
      qc.invalidateQueries({ queryKey: walletKeys.tier() });
      qc.invalidateQueries({ queryKey: walletKeys.sentGifts() });
    },
  });
}

export function useSentGifts() {
  return useQuery({ queryKey: walletKeys.sentGifts(), queryFn: walletApi.getSentGifts });
}

export function useReceivedGifts() {
  return useQuery({ queryKey: walletKeys.receivedGifts(), queryFn: walletApi.getReceivedGifts });
}

export function useGiftTransaction(id: string) {
  return useQuery({
    queryKey: walletKeys.giftTx(id),
    queryFn: () => walletApi.getGiftTransaction(id),
    enabled: !!id,
  });
}

// ── Tier / KYC ─────────────────────────────────────────────────────────────────

export function useKycStatus() {
  return useQuery({ queryKey: walletKeys.kyc(), queryFn: walletApi.getKycStatus });
}

export function useTierLimits() {
  return useQuery({ queryKey: walletKeys.tierLimits(), queryFn: walletApi.getTierLimits });
}

export function useSubmitTier1() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Tier1Input) => walletApi.submitTier1(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: walletKeys.kyc() });
      qc.invalidateQueries({ queryKey: walletKeys.tier() });
      qc.invalidateQueries({ queryKey: walletKeys.summary() });
    },
  });
}

export function useSubmitTier2() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Tier2Input) => walletApi.submitTier2(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: walletKeys.kyc() }),
  });
}

export function useSubmitTier3() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Tier3Input) => walletApi.submitTier3(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: walletKeys.kyc() }),
  });
}

// ── Payouts ──────────────────────────────────────────────────────────────────

export function usePayoutEligibility() {
  return useQuery({ queryKey: walletKeys.payoutEligibility(), queryFn: walletApi.getPayoutEligibility });
}

export function usePayoutHistory() {
  return useQuery({ queryKey: walletKeys.payoutHistory(), queryFn: walletApi.getPayoutHistory });
}

export function useRequestPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PayoutRequestInput) => walletApi.requestPayout(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: walletKeys.payoutEligibility() });
      qc.invalidateQueries({ queryKey: walletKeys.payoutHistory() });
      qc.invalidateQueries({ queryKey: walletKeys.summary() });
    },
  });
}
