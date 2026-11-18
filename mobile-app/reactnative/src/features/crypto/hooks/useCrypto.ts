// React Query hooks mirroring useFx.ts so screens stay declarative and share the
// same caching / loading / error contracts. Money mutations attach an
// Idempotency-Key (iron rule) and invalidate portfolio + transactions on success.

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as crypto from '../api/crypto.api';
import { newIdempotencyKey } from '../utils/cryptoFormatters';
import type {
  ChartRange,
  NewAddressDraft,
  NewPriceAlertDraft,
  QuoteRequest,
  SwapDraft,
  SwapExecution,
  WithdrawalDraft,
  WithdrawalQuote,
} from '../types/crypto.types';

const KEY = 'crypto';

/**
 * A settled copy of `value`, `delayMs` after it stopped changing. The buy/sell/swap
 * entry screens quote against a typed amount, and every keystroke would otherwise be
 * a round trip to the price feed; keying the query on the settled value lets
 * react-query cache per settled amount instead of per keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return settled;
}

export function useCryptoEligibility() {
  return useQuery({ queryKey: [KEY, 'eligibility'], queryFn: crypto.getEligibility, staleTime: 60_000 });
}

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

/**
 * The projected fill, from the server. A trade preview must be the same money the
 * order will move, and only the server knows the rate and the fees — so no screen
 * builds a quote of its own any more. It stays disabled until a positive amount is
 * typed, because the server refuses to price an empty trade (a ₦0.00 preview is not
 * information).
 */
export function useQuote(req: QuoteRequest | null) {
  return useQuery({
    queryKey: [KEY, 'quote', req?.assetId, req?.side, req?.basis, req?.amount ?? null],
    queryFn: () => crypto.createQuote(req as QuoteRequest),
    enabled: Boolean(req && req.assetId && req.amount != null && req.amount > 0),
    staleTime: 0,
    retry: false,
  });
}

/**
 * Place a market order. The fill is priced by the server, so the quote used to
 * build the request is re-fetched at execution instead of carried over from the
 * review screen — the preview can expire, the fill cannot be talked into an old
 * price. Returns the executed order alongside the quote it was built from.
 */
export function usePlaceOrder(side: 'buy' | 'sell') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (req: QuoteRequest) => {
      const quote = await crypto.createQuote(req);
      const key = newIdempotencyKey(side);
      return side === 'buy' ? crypto.executeBuy(quote, key) : crypto.executeSell(quote, key);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'portfolio'] });
      qc.invalidateQueries({ queryKey: [KEY, 'positions'] });
      qc.invalidateQueries({ queryKey: [KEY, 'transactions'] });
    },
  });
}

/**
 * A firm swap quote. Unlike a buy/sell preview this is a POST that can reserve a
 * quotation at the exchange for a few seconds, so it runs ONCE, on the review screen
 * — never per keystroke on the entry screen.
 */
export function useSwapQuote(draft: SwapDraft | null) {
  return useQuery({
    queryKey: [KEY, 'swap-quote', draft?.fromAssetId, draft?.toAssetId, draft?.fromAmount ?? null],
    queryFn: () => crypto.createSwapQuote(draft as SwapDraft),
    enabled: Boolean(draft && draft.fromAssetId && draft.toAssetId && draft.fromAmount > 0),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/** Fill a swap from the quote the member just reviewed, honouring its quotation id. */
export function useExecuteSwap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (exec: SwapExecution) => crypto.executeSwap(exec, newIdempotencyKey('swap')),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'portfolio'] });
      qc.invalidateQueries({ queryKey: [KEY, 'positions'] });
      qc.invalidateQueries({ queryKey: [KEY, 'transactions'] });
    },
  });
}

export function useCryptoPortfolio() {
  return useQuery({ queryKey: [KEY, 'portfolio'], queryFn: crypto.getPortfolio, staleTime: 15_000 });
}

export function usePositions() {
  return useQuery({ queryKey: [KEY, 'positions'], queryFn: crypto.getPositions, staleTime: 15_000 });
}

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

export function useDepositAddress(symbol?: string, networkId?: string) {
  return useQuery({
    queryKey: [KEY, 'deposit-address', symbol, networkId],
    queryFn: () => crypto.getDepositAddress(symbol as string, networkId as string),
    enabled: Boolean(symbol && networkId),
    staleTime: 5 * 60_000,
  });
}

// Money-IN history (GAP-DEP-01 Slice 3). Polls while the caller is watching for a deposit to
// land: a credited row appears in crypto_deposits only once the network clears the confirmation
// floor, so the pending→credited screen re-fetches on an interval until one shows up.
export function useDeposits(symbol?: string, pollMs = 10_000) {
  return useQuery({
    queryKey: [KEY, 'deposits', symbol ?? 'all'],
    queryFn: () => crypto.getDeposits(symbol),
    refetchInterval: pollMs,
  });
}

export function useDeposit(id?: string) {
  return useQuery({
    queryKey: [KEY, 'deposit', id],
    queryFn: () => crypto.getDeposit(id as string),
    enabled: Boolean(id),
  });
}

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

export function useWithdrawalEligibility() {
  return useQuery({ queryKey: [KEY, 'withdrawal-eligibility'], queryFn: crypto.getWithdrawalEligibility, staleTime: 60_000 });
}

export function useQuoteWithdrawal() {
  return useMutation({ mutationFn: (draft: WithdrawalDraft) => crypto.quoteWithdrawal(draft) });
}

export function useInitiateWithdrawal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ draft, quote }: { draft: WithdrawalDraft; quote: WithdrawalQuote }) =>
      crypto.initiateWithdrawal(draft, quote, newIdempotencyKey('wd')),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'portfolio'] });
      qc.invalidateQueries({ queryKey: [KEY, 'transactions'] });
      // A withdrawal consumes the holding and the remaining allowance, so both
      // screens have to re-read rather than show a balance that already left.
      qc.invalidateQueries({ queryKey: [KEY, 'positions'] });
      qc.invalidateQueries({ queryKey: [KEY, 'withdrawal-eligibility'] });
    },
  });
}
