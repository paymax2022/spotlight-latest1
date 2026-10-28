import { useCallback, useRef, useState } from 'react';
import { api } from '@/api/client';
import { unwrapEnvelope } from '@/features/crypto/utils/envelope';
import { nextSwapStatus, type SwapEvent } from '@/features/crypto/utils/swapDisplay';
import type { SwapOrderWire, SwapQuoteWire, SwapStatus } from '@/features/crypto/types/swapWire';

export interface UseSwapReturn {
  quote: SwapQuoteWire | null;
  quoteLoading: boolean;
  quoteError: Error | null;
  getQuote(fromAssetID: string, toAssetID: string, fromUnits: number): Promise<void>;
  confirmSwap(quotationID: string): Promise<SwapOrderWire>;
  swapStatus: SwapStatus;
}

const toError = (e: unknown): Error => {
  const m = e as { response?: { data?: { message?: string } }; message?: string };
  return new Error(m?.response?.data?.message ?? m?.message ?? 'Something went wrong. Please try again.');
};

function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `swap-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Quote + confirm for crypto swaps. Amounts are integer minor units; the server re-prices on confirm. */
export function useCryptoSwap(): UseSwapReturn {
  const [quote, setQuote] = useState<SwapQuoteWire | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<Error | null>(null);
  const [swapStatus, setSwapStatus] = useState<SwapStatus>('idle');
  // One key per quote so a retried confirmation is idempotent.
  const keyRef = useRef<{ quotationID: string; key: string } | null>(null);
  const inFlight = useRef(false);

  const step = useCallback((e: SwapEvent) => setSwapStatus((s) => nextSwapStatus(s, e)), []);

  const getQuote = useCallback(async (from: string, to: string, units: number) => {
    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const res = await api.post('/api/v1/crypto/swap/quote', { from_asset_id: from, to_asset_id: to, from_units: units });
      setQuote(unwrapEnvelope<SwapQuoteWire>(res?.data));
      setSwapStatus('idle');
    } catch (e) {
      setQuote(null);
      setQuoteError(toError(e));
    } finally {
      setQuoteLoading(false);
    }
  }, []);

  const confirmSwap = useCallback(async (quotationID: string): Promise<SwapOrderWire> => {
    if (inFlight.current) throw new Error('A swap is already in progress.');
    if (!quote || quote.quotation_id !== quotationID) throw new Error('Quote not found. Please get a new quote.');
    inFlight.current = true;
    step('confirm');
    if (keyRef.current?.quotationID !== quotationID) keyRef.current = { quotationID, key: newIdempotencyKey() };
    try {
      const res = await api.post(
        '/api/v1/crypto/swap',
        { from_asset_id: quote.from_asset_id, to_asset_id: quote.to_asset_id, from_units: quote.from_units },
        { headers: { 'Idempotency-Key': keyRef.current.key } },
      );
      step('accepted');
      const order = unwrapEnvelope<SwapOrderWire>(res?.data);
      if (order.status === 'failed') step('error');
      else if (order.status === 'completed') step('settled');
      return order;
    } catch (e) {
      step('error');
      throw toError(e);
    } finally {
      inFlight.current = false;
    }
  }, [quote, step]);

  return { quote, quoteLoading, quoteError, getQuote, confirmSwap, swapStatus };
}
