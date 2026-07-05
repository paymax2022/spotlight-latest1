// ── Invest — React Query data hooks ──────────────────────────────────────────
// Keeps screens declarative and shares caching / loading / error contracts.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as invest from '../api/invest.api';
import type { BuyOrderRequest, SellOrderRequest } from '../types/invest.types';
import { newIdempotencyKey } from '../utils/format';

const KEY = 'invest';

// ── Profile / eligibility ────────────────────────────────────────────────────

export function useInvestProfile() {
  return useQuery({ queryKey: [KEY, 'profile'], queryFn: invest.getProfile, staleTime: 30_000 });
}

export function useEligibility() {
  return useQuery({ queryKey: [KEY, 'eligibility'], queryFn: invest.getEligibility, staleTime: 30_000 });
}

export function useStartInvesting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: invest.startInvesting,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'profile'] });
      qc.invalidateQueries({ queryKey: [KEY, 'eligibility'] });
    },
  });
}

export function useAgreements() {
  return useQuery({ queryKey: [KEY, 'agreements'], queryFn: invest.getAgreements });
}

export function useAcceptAgreements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: invest.acceptAgreements,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'agreements'] });
      qc.invalidateQueries({ queryKey: [KEY, 'eligibility'] });
    },
  });
}

export function useSuitabilityQuestions() {
  return useQuery({ queryKey: [KEY, 'suitability', 'questions'], queryFn: invest.getSuitabilityQuestions });
}

export function useSubmitSuitability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (answers: Record<string, number>) => invest.submitSuitability(answers),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'eligibility'] });
      qc.invalidateQueries({ queryKey: [KEY, 'profile'] });
    },
  });
}

// ── Transaction PIN ──────────────────────────────────────────────────────────

export function usePINStatus() {
  return useQuery({ queryKey: [KEY, 'pin-status'], queryFn: invest.getPINStatus, staleTime: 60_000 });
}

export function useSetPIN() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pin, currentPin }: { pin: string; currentPin?: string }) => invest.setPIN(pin, currentPin),
    onSettled: () => qc.invalidateQueries({ queryKey: [KEY, 'pin-status'] }),
  });
}

// ── Stocks ───────────────────────────────────────────────────────────────────

export function useStocks(query?: string, sector?: string) {
  return useQuery({
    queryKey: [KEY, 'stocks', query ?? '', sector ?? ''],
    queryFn: () => invest.listStocks(query, sector),
    staleTime: 15_000,
  });
}

export function useStock(symbol: string) {
  return useQuery({
    queryKey: [KEY, 'stock', symbol],
    queryFn: () => invest.getStock(symbol),
    enabled: !!symbol,
    staleTime: 10_000,
  });
}

export function useStockChart(symbol: string, range = '1m') {
  return useQuery({
    queryKey: [KEY, 'chart', symbol, range],
    queryFn: () => invest.getStockChart(symbol, range),
    enabled: !!symbol,
  });
}

export function useMarketStatus() {
  return useQuery({ queryKey: [KEY, 'market-status'], queryFn: invest.getMarketStatus, staleTime: 60_000 });
}

// ── Orders ───────────────────────────────────────────────────────────────────

export function useBuyOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: BuyOrderRequest) => invest.placeBuyOrder(req, newIdempotencyKey('buy')),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'orders'] });
      qc.invalidateQueries({ queryKey: [KEY, 'portfolio'] });
      qc.invalidateQueries({ queryKey: [KEY, 'wallet'] });
    },
  });
}

export function useSellOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: SellOrderRequest) => invest.placeSellOrder(req, newIdempotencyKey('sell')),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'orders'] });
      qc.invalidateQueries({ queryKey: [KEY, 'portfolio'] });
      qc.invalidateQueries({ queryKey: [KEY, 'wallet'] });
    },
  });
}

export function useOrders(status?: string) {
  return useQuery({ queryKey: [KEY, 'orders', status ?? ''], queryFn: () => invest.listOrders(status) });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invest.cancelOrder(id),
    onSettled: () => qc.invalidateQueries({ queryKey: [KEY, 'orders'] }),
  });
}

// ── Portfolio / wallet ───────────────────────────────────────────────────────

export function usePortfolio() {
  return useQuery({ queryKey: [KEY, 'portfolio'], queryFn: invest.getPortfolio, staleTime: 15_000 });
}

export function useInvestWallet() {
  return useQuery({ queryKey: [KEY, 'wallet'], queryFn: invest.getWallet, staleTime: 15_000 });
}

export function useDeposit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountKobo: number) => invest.depositToWallet(amountKobo, newIdempotencyKey('dep')),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'wallet'] });
      qc.invalidateQueries({ queryKey: [KEY, 'portfolio'] });
    },
  });
}

export function useWithdraw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountKobo: number) => invest.withdrawFromWallet(amountKobo, newIdempotencyKey('wd')),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'wallet'] });
      qc.invalidateQueries({ queryKey: [KEY, 'portfolio'] });
    },
  });
}

// ── Watchlists ───────────────────────────────────────────────────────────────

export function useWatchlists() {
  return useQuery({ queryKey: [KEY, 'watchlists'], queryFn: invest.getWatchlists, staleTime: 30_000 });
}

export function useAddToWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ watchlistId, symbol }: { watchlistId: string; symbol: string }) =>
      invest.addToWatchlist(watchlistId, symbol),
    onSettled: () => qc.invalidateQueries({ queryKey: [KEY, 'watchlists'] }),
  });
}

export function useRemoveFromWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ watchlistId, assetId }: { watchlistId: string; assetId: string }) =>
      invest.removeFromWatchlist(watchlistId, assetId),
    onSettled: () => qc.invalidateQueries({ queryKey: [KEY, 'watchlists'] }),
  });
}
