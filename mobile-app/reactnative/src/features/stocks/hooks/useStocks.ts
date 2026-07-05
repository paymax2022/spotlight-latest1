// ── Paymax Invest · Stocks — Data hooks ──────────────────────────────────────
// React Query hooks mirroring useCrypto.ts so screens stay declarative and share
// the same caching / loading / error contracts. Money mutations attach an
// Idempotency-Key (iron rule) and invalidate portfolio + orders on success.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as stocks from '../api/stocks.api';
import { newIdempotencyKey } from '../utils/stockFormatters';
import type { ChartRange, OrderDraft, OrderSide } from '../types/stocks.types';

const KEY = 'stocks';

// ─── Assets, chart, news, dividends, corporate actions ────────────────────────

export function useStocks() {
  return useQuery({ queryKey: [KEY, 'list'], queryFn: stocks.getStocks, staleTime: 20_000, refetchInterval: 30_000 });
}

export function useStock(symbol?: string) {
  return useQuery({
    queryKey: [KEY, 'asset', symbol],
    queryFn: () => stocks.getStock(symbol as string),
    enabled: Boolean(symbol),
    staleTime: 15_000,
  });
}

export function useStockChart(symbol: string | undefined, range: ChartRange) {
  return useQuery({
    queryKey: [KEY, 'chart', symbol, range],
    queryFn: () => stocks.getChart(symbol as string, range),
    enabled: Boolean(symbol),
    staleTime: 30_000,
  });
}

export function useStockNews(symbol?: string) {
  return useQuery({
    queryKey: [KEY, 'news', symbol],
    queryFn: () => stocks.getNews(symbol as string),
    enabled: Boolean(symbol),
    staleTime: 60_000,
  });
}

export function useDividends(symbol?: string) {
  return useQuery({
    queryKey: [KEY, 'dividends', symbol],
    queryFn: () => stocks.getDividends(symbol as string),
    enabled: Boolean(symbol),
    staleTime: 60_000,
  });
}

export function useCorporateActions(symbol?: string) {
  return useQuery({
    queryKey: [KEY, 'corporate-actions', symbol],
    queryFn: () => stocks.getCorporateActions(symbol as string),
    enabled: Boolean(symbol),
    staleTime: 60_000,
  });
}

// ─── Portfolio & positions ────────────────────────────────────────────────────

export function useStockPortfolio() {
  return useQuery({ queryKey: [KEY, 'portfolio'], queryFn: stocks.getPortfolio, staleTime: 15_000 });
}

export function useStockPositions() {
  return useQuery({ queryKey: [KEY, 'positions'], queryFn: stocks.getPositions, staleTime: 15_000 });
}

// ─── Place order (money mutation → Idempotency-Key) ───────────────────────────

export function usePlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: OrderDraft) => stocks.placeOrder(draft, newIdempotencyKey('order')),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'portfolio'] });
      qc.invalidateQueries({ queryKey: [KEY, 'positions'] });
      qc.invalidateQueries({ queryKey: [KEY, 'orders'] });
    },
  });
}

// ─── Orders ─────────────────────────────────────────────────────────────────--

export function useStockOrders(side?: OrderSide) {
  return useQuery({
    queryKey: [KEY, 'orders', side ?? 'all'],
    queryFn: () => stocks.getOrders(side),
    staleTime: 15_000,
  });
}

export function useStockOrder(id?: string) {
  return useQuery({
    queryKey: [KEY, 'order', id],
    queryFn: () => stocks.getOrder(id as string),
    enabled: Boolean(id),
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => stocks.cancelOrder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'orders'] });
      qc.invalidateQueries({ queryKey: [KEY, 'order'] });
      qc.invalidateQueries({ queryKey: [KEY, 'portfolio'] });
    },
  });
}

// ─── Public offers ────────────────────────────────────────────────────────────

export function usePublicOffers() {
  return useQuery({ queryKey: [KEY, 'offers'], queryFn: stocks.getPublicOffers, staleTime: 30_000 });
}

export function usePublicOffer(id?: string) {
  return useQuery({
    queryKey: [KEY, 'offer', id],
    queryFn: () => stocks.getPublicOffer(id as string),
    enabled: Boolean(id),
  });
}

export function useApplyToOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, units }: { id: string; units: number }) =>
      stocks.applyToOffer(id, units, newIdempotencyKey('offer')),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'offers'] });
      qc.invalidateQueries({ queryKey: [KEY, 'orders'] });
    },
  });
}
