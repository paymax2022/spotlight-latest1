// ── Paymax Invest · Crypto — Data hooks ──────────────────────────────────────
// React Query hooks mirroring useFx.ts so screens stay declarative and share the
// same caching / loading / error contracts. Money mutations attach an
// Idempotency-Key (iron rule) and invalidate portfolio + transactions on success.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as crypto from '../api/crypto.api';
import { newIdempotencyKey } from '../utils/cryptoFormatters';
import type {
  ChartRange,
  CryptoQuote,
  NewAddressDraft,
  NewPriceAlertDraft,
  QuoteRequest,
  SwapDraft,
  SwapQuote,
  WithdrawalDraft,
  WithdrawalQuote,
} from '../types/crypto.types';
// CryptoQuote is used as the mutation argument type for buy/sell.

const KEY = 'crypto';

// ─── Eligibility ──────────────────────────────────────────────────────────────

export function useCryptoEligibility() {
  return useQuery({ queryKey: [KEY, 'eligibility'], queryFn: crypto.getEligibility, staleTime: 60_000 });
}

// ─── Assets & chart ─────────────────────────────────────────────────────────--

export function useAssets() {
  return useQuery({ queryKey: [KEY, 'assets'], queryFn: crypto.getAssets, staleTime: 20_000, refetchInterval: 30_000 });
}

export function useAsset(symbol?: string) {
  return useQuery({
    queryKey: [KEY, 'asset', symbol],
    queryFn: () => crypto.getAsset(symbol as string),
    enabled: Boolean(symbol),
    staleTime: 15_000,
  });
}

export function useChart(symbol: string | undefined, range: ChartRange) {
  return useQuery({
    queryKey: [KEY, 'chart', symbol, range],
    queryFn: () => crypto.getChart(symbol as string, range),
    enabled: Boolean(symbol),
    staleTime: 30_000,
  });
}

// ─── Quotes ─────────────────────────────────────────────────────────────────--

export function useCreateQuote() {
  return useMutation({ mutationFn: (req: QuoteRequest) => crypto.createQuote(req) });
}

// ─── Buy / sell (money mutations → Idempotency-Key) ───────────────────────────

export function useExecuteBuy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quote: CryptoQuote) => crypto.executeBuy(quote, newIdempotencyKey('buy')),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'portfolio'] });
      qc.invalidateQueries({ queryKey: [KEY, 'positions'] });
      qc.invalidateQueries({ queryKey: [KEY, 'transactions'] });
    },
  });
}

export function useExecuteSell() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quote: CryptoQuote) => crypto.executeSell(quote, newIdempotencyKey('sell')),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'portfolio'] });
      qc.invalidateQueries({ queryKey: [KEY, 'positions'] });
      qc.invalidateQueries({ queryKey: [KEY, 'transactions'] });
    },
  });
}

// ─── Swap ─────────────────────────────────────────────────────────────────────

export function useCreateSwapQuote() {
  return useMutation({ mutationFn: (draft: SwapDraft) => crypto.createSwapQuote(draft) });
}

export function useExecuteSwap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quote: SwapQuote) => crypto.executeSwap(quote, newIdempotencyKey('swap')),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'portfolio'] });
      qc.invalidateQueries({ queryKey: [KEY, 'positions'] });
      qc.invalidateQueries({ queryKey: [KEY, 'transactions'] });
    },
  });
}

// ─── Portfolio & positions ────────────────────────────────────────────────────

export function useCryptoPortfolio() {
  return useQuery({ queryKey: [KEY, 'portfolio'], queryFn: crypto.getPortfolio, staleTime: 15_000 });
}

export function usePositions() {
  return useQuery({ queryKey: [KEY, 'positions'], queryFn: crypto.getPositions, staleTime: 15_000 });
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export function useCryptoTransactions(side?: 'buy' | 'sell') {
  return useQuery({
    queryKey: [KEY, 'transactions', side ?? 'all'],
    queryFn: () => crypto.getTransactions(side),
    staleTime: 15_000,
  });
}

export function useCryptoTransaction(id?: string) {
  return useQuery({
    queryKey: [KEY, 'transaction', id],
    queryFn: () => crypto.getTransaction(id as string),
    enabled: Boolean(id),
  });
}

// ─── Deposit ──────────────────────────────────────────────────────────────────

export function useDepositAddress(symbol?: string, networkId?: string) {
  return useQuery({
    queryKey: [KEY, 'deposit-address', symbol, networkId],
    queryFn: () => crypto.getDepositAddress(symbol as string, networkId as string),
    enabled: Boolean(symbol && networkId),
    staleTime: 5 * 60_000,
  });
}

// ─── Watchlist ────────────────────────────────────────────────────────────────

export function useWatchlist() {
  return useQuery({ queryKey: [KEY, 'watchlist'], queryFn: crypto.getWatchlist, staleTime: 20_000 });
}

export function useToggleWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assetId, watched }: { assetId: string; watched: boolean }) =>
      watched ? crypto.removeFromWatchlist(assetId) : crypto.addToWatchlist(assetId),
    onSettled: () => qc.invalidateQueries({ queryKey: [KEY, 'watchlist'] }),
  });
}

// ─── Price alerts ─────────────────────────────────────────────────────────────

export function useAlerts() {
  return useQuery({ queryKey: [KEY, 'alerts'], queryFn: crypto.getAlerts, staleTime: 30_000 });
}

export function useCreateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: NewPriceAlertDraft) => crypto.createAlert(draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'alerts'] }),
  });
}

export function useDeleteAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => crypto.deleteAlert(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'alerts'] }),
  });
}

// ─── Withdrawal address book ──────────────────────────────────────────────────

export function useAddresses(symbol?: string) {
  return useQuery({
    queryKey: [KEY, 'addresses', symbol ?? 'all'],
    queryFn: () => crypto.getAddresses(symbol),
    staleTime: 30_000,
  });
}

export function useScreenAddress() {
  return useMutation({ mutationFn: (address: string) => crypto.screenAddress(address) });
}

export function useAddAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: NewAddressDraft) => crypto.addAddress(draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'addresses'] }),
  });
}

export function useDeleteAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => crypto.deleteAddress(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'addresses'] }),
  });
}

// ─── Withdrawal ───────────────────────────────────────────────────────────────

export function useWithdrawalEligibility() {
  return useQuery({ queryKey: [KEY, 'withdrawal-eligibility'], queryFn: crypto.getWithdrawalEligibility, staleTime: 60_000 });
}

export function useQuoteWithdrawal() {
  return useMutation({ mutationFn: (draft: WithdrawalDraft) => crypto.quoteWithdrawal(draft) });
}

export function useInitiateWithdrawal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ draft, quote, otp }: { draft: WithdrawalDraft; quote: WithdrawalQuote; otp: string }) =>
      crypto.initiateWithdrawal(draft, quote, otp, newIdempotencyKey('wd')),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'portfolio'] });
      qc.invalidateQueries({ queryKey: [KEY, 'transactions'] });
    },
  });
}
