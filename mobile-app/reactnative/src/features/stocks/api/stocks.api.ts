// ── Paymax Invest · Stocks — API wrapper ─────────────────────────────────────
// Typed data layer the screens code against. Mirrors crypto.api.ts: mock-flagged.
// Flip EXPO_PUBLIC_STOCKS_USE_MOCK=false once the real Paymax /api/v1/stocks
// endpoints land.
//
// IRON RULES (same as crypto):
//  • all money is integer minor units;
//  • every order mutation carries an Idempotency-Key;
//  • the client never computes fees/eligibility authoritatively — server wins.

import { api } from '@/api/client';
import { buildEstimate, chartFor } from '../utils/stockFormatters';
import {
  MOCK_CORPORATE_ACTIONS,
  MOCK_DIVIDENDS,
  MOCK_NEWS,
  MOCK_OFFERS,
  MOCK_ORDERS,
  MOCK_POSITIONS,
  MOCK_STOCKS,
} from './stocks.mock';
import type {
  Candle,
  ChartRange,
  CorporateAction,
  Dividend,
  OrderDraft,
  OrderSide,
  PublicOffer,
  StockAsset,
  StockNews,
  StockOrder,
  StockOrderStatus,
  StockPortfolio,
  StockPosition,
} from '../types/stocks.types';

// ─── Feature flag: flip to false once real endpoints are ready ────────────────
const USE_MOCK = (process.env.EXPO_PUBLIC_STOCKS_USE_MOCK ?? 'true').toLowerCase() !== 'false';

/** Simulated network latency so loading states render in mock mode. */
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;

/** A stock error carries the backend's `type` on `stockType` for special-case paths. */
type StockError = Error & { stockType?: string };

/**
 * Normalise a thrown axios error into an Error carrying the Go backend's real
 * message + error `type`. The Go API returns `{ type, code, message }` with a
 * non-2xx status; surface `message` to the screens and preserve `type` (e.g.
 * 'market_closed') on `stockType` so the special-case path still works.
 */
function toStockError(err: unknown): Error {
  const e = err as { response?: { data?: { type?: string; message?: string } }; message?: string };
  const data = e?.response?.data;
  const msg = data?.message ?? e?.message ?? 'Something went wrong. Please try again.';
  const out = new Error(msg) as StockError;
  if (data?.type) out.stockType = data.type;
  return out;
}

/** Build a stock error with an explicit type (mock pre-trade checks). */
function makeStockError(message: string, type: string): StockError {
  const err = new Error(message) as StockError;
  err.stockType = type;
  return err;
}

function requireAsset(idOrSymbol: string): StockAsset {
  const asset = MOCK_STOCKS.find((a) => a.id === idOrSymbol || a.symbol === idOrSymbol);
  if (!asset) throw new Error('Stock not found');
  return asset;
}

// ─── Assets (GET /stocks, /stocks/:symbol) ────────────────────────────────────

export async function getStocks(): Promise<StockAsset[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_STOCKS]; }
  return unwrap<StockAsset[]>(await api.get('/api/v1/stocks'));
}

export async function getStock(symbol: string): Promise<StockAsset> {
  if (USE_MOCK) { await delay(220); return requireAsset(symbol); }
  return unwrap<StockAsset>(await api.get(`/api/v1/stocks/${symbol}`));
}

/** Deterministic mock price history for the asset chart. */
export async function getChart(symbol: string, range: ChartRange): Promise<Candle[]> {
  if (USE_MOCK) { await delay(240); return chartFor(requireAsset(symbol), range); }
  return unwrap<Candle[]>(await api.get(`/api/v1/stocks/${symbol}/chart`, { params: { range } }));
}

export async function getNews(symbol: string): Promise<StockNews[]> {
  if (USE_MOCK) { await delay(240); void symbol; return [...MOCK_NEWS]; }
  return unwrap<StockNews[]>(await api.get(`/api/v1/stocks/${symbol}/news`));
}

export async function getDividends(symbol: string): Promise<Dividend[]> {
  if (USE_MOCK) {
    await delay(220);
    return MOCK_DIVIDENDS.filter((d) => d.symbol === symbol);
  }
  return unwrap<Dividend[]>(await api.get(`/api/v1/stocks/${symbol}/dividends`));
}

export async function getCorporateActions(symbol: string): Promise<CorporateAction[]> {
  if (USE_MOCK) {
    await delay(220);
    return MOCK_CORPORATE_ACTIONS.filter((c) => c.symbol === symbol);
  }
  return unwrap<CorporateAction[]>(await api.get(`/api/v1/stocks/${symbol}/corporate-actions`));
}

// ─── Portfolio (GET /portfolio, /portfolio/positions) ─────────────────────────

// NOTE: there is no generic /api/v1/portfolio endpoint on the Go backend.
// Invest exposes its own portfolio at /api/v1/invest/portfolio (aggregate
// stocks + cash); this module reuses it and derives the stocks-only view.
export async function getPortfolio(): Promise<StockPortfolio> {
  if (USE_MOCK) {
    await delay(280);
    const positions = [...MOCK_POSITIONS];
    // Base everything in NGN for the summary (display only in mock mode).
    const totalValue = positions.reduce((s, p) => s + p.marketValue.amount, 0);
    const totalCost = positions.reduce((s, p) => s + p.costBasis.amount, 0);
    const gain = totalValue - totalCost;
    const day = positions.reduce(
      (s, p) => s + Math.round((p.marketValue.amount * p.change24hPct) / 100), 0,
    );
    const prevValue = totalValue - day;
    return {
      baseCurrency: 'NGN',
      totalValue: { amount: totalValue, currency: 'NGN' },
      totalCostBasis: { amount: totalCost, currency: 'NGN' },
      totalGainLoss: { amount: gain, currency: 'NGN' },
      totalGainLossPct: totalCost ? +((gain / totalCost) * 100).toFixed(2) : 0,
      dayChange: { amount: day, currency: 'NGN' },
      dayChangePct: prevValue ? +((day / prevValue) * 100).toFixed(2) : 0,
      investableBalance: { amount: Math.round(1_250_000 * 100), currency: 'NGN' },
      positions,
    };
  }
  return unwrap<StockPortfolio>(await api.get('/api/v1/invest/portfolio'));
}

export async function getPositions(): Promise<StockPosition[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_POSITIONS]; }
  return unwrap<StockPosition[]>(await api.get('/api/v1/invest/portfolio/positions'));
}

// ─── Place order (POST /stocks/orders) ────────────────────────────────────────
// Money mutation → pre-trade check + Idempotency-Key + provider ref.

export async function placeOrder(draft: OrderDraft, idempotencyKey: string): Promise<StockOrder> {
  if (USE_MOCK) {
    await delay(1100);
    const asset = requireAsset(draft.assetId);
    const estimate = buildEstimate(asset, draft);

    // Pre-trade checks (server-authoritative in production).
    if (draft.orderType === 'market' && asset.marketStatus === 'closed') {
      throw makeStockError(
        'The market is closed, so this market order cannot be filled right now. Try a limit order or come back when the market opens.',
        'market_closed',
      );
    }
    const total = estimate.total.amount;
    // Illustrative balance for the buy pre-check (matches portfolio investable balance for NGN).
    const investable = asset.currency === 'NGN' ? Math.round(1_250_000 * 100) : Math.round(2_000 * 100);
    if (draft.side === 'buy' && total > investable) {
      throw makeStockError(
        'You don\'t have enough available balance to place this order. Add funds and try again.',
        'insufficient_balance',
      );
    }
    if (estimate.gross.amount < asset.minOrderAmount || estimate.gross.amount > asset.maxOrderAmount) {
      throw makeStockError(
        'This order is outside the allowed limits for this stock. Adjust the quantity and try again.',
        'limit_exceeded',
      );
    }

    const now = new Date().toISOString();
    // Market orders fill (then settle); limit orders rest as Submitted.
    const status: StockOrderStatus = draft.orderType === 'market' ? 'Filled' : 'Submitted';
    const filledQuantity = draft.orderType === 'market' ? draft.quantity : 0;
    const settle = new Date(Date.now() + (asset.settlementCycle === 'T+2' ? 2 : 3) * 86_400_000).toISOString();

    return {
      id: `so_${Date.now()}`,
      reference: `PMX-ST-${Date.now().toString().slice(-6)}`,
      assetId: asset.id, symbol: asset.symbol, name: asset.name,
      side: draft.side, orderType: draft.orderType, status,
      quantity: draft.quantity, filledQuantity,
      price: draft.orderType === 'limit' && estimate.limitPrice ? estimate.limitPrice : estimate.estPrice,
      limitPrice: estimate.limitPrice,
      gross: estimate.gross, fees: estimate.fees, total: estimate.total,
      provider: 'mock-broker',
      providerReference: `BR-${Date.now().toString().slice(-5)}-XY`,
      settlementDate: draft.orderType === 'market' ? settle : undefined,
      idempotencyKey,
      createdAt: now,
      statusHistory:
        draft.orderType === 'market'
          ? [
              { status: 'Submitted', at: now },
              { status: 'AcceptedByProvider', at: now },
              { status: 'Filled', at: now },
            ]
          : [
              { status: 'AwaitingUserConfirmation', at: now },
              { status: 'Submitted', at: now },
            ],
    };
  }
  // Backend has no unified /stocks/orders — buy/sell are separate endpoints.
  try {
    const path = draft.side === 'buy' ? '/api/v1/stocks/orders/buy' : '/api/v1/stocks/orders/sell';
    const body = draft.side === 'buy'
      ? { symbol: draft.symbol, order_type: draft.orderType, quantity: draft.quantity, limit_price_kobo: draft.limitPrice }
      : { symbol: draft.symbol, order_type: draft.orderType, quantity: draft.quantity, limit_price_kobo: draft.limitPrice };
    return unwrap<StockOrder>(
      await api.post(path, body, { headers: { 'Idempotency-Key': idempotencyKey } }),
    );
  } catch (err) {
    throw toStockError(err);
  }
}

// ─── Orders (GET /stocks/orders[/:id], POST /:id/cancel) ──────────────────────

export async function getOrders(side?: OrderSide): Promise<StockOrder[]> {
  if (USE_MOCK) {
    await delay();
    let list = [...MOCK_ORDERS];
    if (side) list = list.filter((o) => o.side === side);
    return list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return unwrap<StockOrder[]>(await api.get('/api/v1/stocks/orders', { params: { side } }));
}

export async function getOrder(id: string): Promise<StockOrder> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_ORDERS.find((o) => o.id === id || o.reference === id);
    if (!found) throw new Error('Order not found');
    return found;
  }
  return unwrap<StockOrder>(await api.get(`/api/v1/stocks/orders/${id}`));
}

export async function cancelOrder(id: string): Promise<StockOrder> {
  if (USE_MOCK) {
    await delay(900);
    const found = MOCK_ORDERS.find((o) => o.id === id || o.reference === id);
    if (!found) throw new Error('Order not found');
    const now = new Date().toISOString();
    return {
      ...found,
      status: 'Cancelled',
      statusHistory: [
        ...found.statusHistory,
        { status: 'CancelRequested', at: now },
        { status: 'Cancelled', at: now },
      ],
      failureReason: 'You cancelled this order. No funds were debited.',
    };
  }
  try {
    return unwrap<StockOrder>(await api.post(`/api/v1/stocks/orders/${id}/cancel`, {}));
  } catch (err) {
    throw toStockError(err);
  }
}

// ─── Public offers (GET /stocks/offers[/:id], POST /:id/apply) ────────────────

// NOTE: backend splits IPOs from rights issues under /invest/public-offers and
// /invest/rights-issues respectively (no unified /stocks/offers). This fetches
// and merges both so the screens keep a single PublicOffer[] contract.
export async function getPublicOffers(): Promise<PublicOffer[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_OFFERS]; }
  const [ipos, rights] = await Promise.all([
    unwrap<PublicOffer[]>(await api.get('/api/v1/invest/public-offers')),
    unwrap<PublicOffer[]>(await api.get('/api/v1/invest/rights-issues')),
  ]);
  return [...(ipos ?? []), ...(rights ?? [])];
}

export async function getPublicOffer(id: string): Promise<PublicOffer> {
  if (USE_MOCK) {
    await delay(220);
    const found = MOCK_OFFERS.find((o) => o.id === id || o.symbol === id);
    if (!found) throw new Error('Offer not found');
    return found;
  }
  try {
    return unwrap<PublicOffer>(await api.get(`/api/v1/invest/public-offers/${id}`));
  } catch {
    return unwrap<PublicOffer>(await api.get(`/api/v1/invest/rights-issues/${id}`));
  }
}

/** Apply to an IPO / rights issue — money mutation → Idempotency-Key. */
export async function applyToOffer(id: string, units: number, idempotencyKey: string): Promise<StockOrder> {
  if (USE_MOCK) {
    await delay(1100);
    const offer = MOCK_OFFERS.find((o) => o.id === id || o.symbol === id);
    if (!offer) throw new Error('Offer not found');
    if (offer.status !== 'open') {
      throw makeStockError('This offer is not currently open for applications.', 'limit_exceeded');
    }
    if (units < offer.minUnits) {
      throw makeStockError(
        `The minimum application for this offer is ${offer.minUnits.toLocaleString()} units.`,
        'limit_exceeded',
      );
    }
    const unitPrice = offer.priceHigh.amount;
    const gross = Math.round(unitPrice * units);
    const now = new Date().toISOString();
    return {
      id: `so_offer_${Date.now()}`,
      reference: `PMX-OF-${Date.now().toString().slice(-6)}`,
      assetId: `offer_${offer.id}`, symbol: offer.symbol, name: offer.name,
      side: 'buy', orderType: 'limit', status: 'Submitted',
      quantity: units, filledQuantity: 0,
      price: offer.priceHigh, limitPrice: offer.priceHigh,
      gross: { amount: gross, currency: offer.priceHigh.currency },
      fees: [],
      total: { amount: gross, currency: offer.priceHigh.currency },
      provider: 'mock-registrar',
      providerReference: `RG-${Date.now().toString().slice(-5)}-OF`,
      idempotencyKey,
      createdAt: now,
      statusHistory: [
        { status: 'AwaitingUserConfirmation', at: now },
        { status: 'Submitted', at: now },
      ],
    };
  }
  try {
    return unwrap<StockOrder>(
      await api.post(`/api/v1/invest/public-offers/${id}/apply`, { units }, { headers: { 'Idempotency-Key': idempotencyKey } }),
    );
  } catch (err) {
    throw toStockError(err);
  }
}
