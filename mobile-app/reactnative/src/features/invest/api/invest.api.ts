// ── Invest — typed API layer the screens code against ────────────────────────
// Mock-flagged (INVEST_USE_MOCK). Flip with EXPO_PUBLIC_INVEST_USE_MOCK=false to
// hit the Go backend (/api/v1/invest, /api/v1/stocks).
//
// IRON RULES honoured: money is integer kobo; every order/funding mutation
// carries an Idempotency-Key; the client never computes fees/limits itself.

import {
  INVEST_USE_MOCK, waitMock, investGet, investPost, investDelete,
} from './invest.client';
import type {
  StockWithQuote, Profile, Eligibility, Agreement, SuitabilityQuestion,
  SuitabilityResult, PortfolioView, WalletView, Watchlist, Order, Receipt,
  BuyOrderRequest, SellOrderRequest, Candle, PublicOffer,
} from '../types/invest.types';
import {
  MOCK_STOCKS, MOCK_PROFILE, MOCK_ELIGIBILITY, MOCK_AGREEMENTS,
  MOCK_SUITABILITY_QUESTIONS, MOCK_PORTFOLIO, MOCK_WALLET, MOCK_WATCHLISTS,
  MOCK_ORDERS, MOCK_PUBLIC_OFFERS,
} from './invest.mock';

// ── Profile / onboarding ─────────────────────────────────────────────────────

export async function getProfile(): Promise<Profile> {
  if (INVEST_USE_MOCK) return waitMock(MOCK_PROFILE);
  return investGet<Profile>('/invest/profile');
}

export async function startInvesting(): Promise<Profile> {
  if (INVEST_USE_MOCK) return waitMock({ ...MOCK_PROFILE, status: 'suitability_required' });
  return investPost<Profile>('/invest/start');
}

export async function getEligibility(): Promise<Eligibility> {
  if (INVEST_USE_MOCK) return waitMock(MOCK_ELIGIBILITY);
  return investGet<Eligibility>('/invest/eligibility');
}

export async function getAgreements(): Promise<Agreement[]> {
  if (INVEST_USE_MOCK) return waitMock(MOCK_AGREEMENTS);
  return investGet<Agreement[]>('/invest/agreements');
}

export async function acceptAgreements(): Promise<void> {
  if (INVEST_USE_MOCK) return waitMock(undefined);
  await investPost('/invest/agreements/accept');
}

// ── Suitability ──────────────────────────────────────────────────────────────

export async function getSuitabilityQuestions(): Promise<SuitabilityQuestion[]> {
  if (INVEST_USE_MOCK) return waitMock(MOCK_SUITABILITY_QUESTIONS);
  return investGet<SuitabilityQuestion[]>('/invest/suitability/questions');
}

export async function submitSuitability(answers: Record<string, number>): Promise<SuitabilityResult> {
  if (INVEST_USE_MOCK) {
    const score = Object.values(answers).reduce((a, b) => a + b, 0);
    return waitMock({ suitability_profile_id: 'mock', score, risk_category: 'balanced', eligibility: ['standard_equities', 'etfs', 'public_offers'] });
  }
  return investPost<SuitabilityResult>('/invest/suitability/submit', { answers });
}

// ── Stocks / discovery ───────────────────────────────────────────────────────

export async function listStocks(query?: string, sector?: string): Promise<StockWithQuote[]> {
  if (INVEST_USE_MOCK) {
    const ql = (query ?? '').toLowerCase();
    return waitMock(MOCK_STOCKS.filter((s) =>
      !ql || s.symbol.toLowerCase().includes(ql) || s.name.toLowerCase().includes(ql)));
  }
  return investGet<StockWithQuote[]>('/stocks', { q: query, sector });
}

export async function getStock(symbol: string): Promise<StockWithQuote> {
  if (INVEST_USE_MOCK) {
    const s = MOCK_STOCKS.find((x) => x.symbol === symbol) ?? MOCK_STOCKS[0];
    return waitMock(s);
  }
  return investGet<StockWithQuote>(`/stocks/${symbol}`);
}

export async function getStockChart(symbol: string, range = '1m'): Promise<Candle[]> {
  if (INVEST_USE_MOCK) {
    const base = (MOCK_STOCKS.find((x) => x.symbol === symbol)?.quote.price_kobo ?? 5_000_00);
    const n = 30;
    return waitMock(Array.from({ length: n }, (_, i) => {
      const drift = ((i % 11) - 5) * (base / 100);
      const c = base + drift;
      return { t: Math.floor(Date.now() / 1000) - (n - i) * 86400, o: c - base / 200, h: c + base / 100, l: c - base / 100, c, v: 100000 };
    }));
  }
  return investGet<Candle[]>(`/stocks/${symbol}/chart`, { range });
}

export async function getMarketStatus(): Promise<{ market_status: string }> {
  if (INVEST_USE_MOCK) return waitMock({ market_status: 'open' });
  return investGet<{ market_status: string }>('/stocks/market-status');
}

// ── Orders ───────────────────────────────────────────────────────────────────

export async function placeBuyOrder(req: BuyOrderRequest, idempotencyKey: string): Promise<Receipt> {
  if (INVEST_USE_MOCK) {
    const stock = MOCK_STOCKS.find((s) => s.symbol === req.symbol) ?? MOCK_STOCKS[0];
    const price = req.limit_price_kobo || stock.quote.price_kobo;
    const amount = req.amount_kobo ?? Math.round((req.quantity ?? 0) * price);
    const fees = Math.max(Math.round(amount * 0.015), 10_000);
    const qty = req.quantity ?? amount / price;
    const order: Order = {
      id: 'mock-' + Date.now(), symbol: req.symbol, side: 'buy', order_type: req.order_type ?? 'market',
      amount_kobo: amount, quantity: qty, limit_price_kobo: req.limit_price_kobo ?? 0,
      estimated_price_kobo: price, executed_price_kobo: price, filled_quantity: qty,
      fees_kobo: fees, total_amount_kobo: amount + fees, status: 'PendingSettlement',
      provider_reference: 'mbk_mock', created_at: new Date().toISOString(),
    };
    return waitMock({ order, risk_disclosure: 'Stock prices can rise or fall. This is not financial advice.', settlement_note: `Shares are credited after T+${stock.settlement_days} settlement.` });
  }
  return investPost<Receipt>('/stocks/orders/buy', req, idempotencyKey);
}

export async function placeSellOrder(req: SellOrderRequest, idempotencyKey: string): Promise<Receipt> {
  if (INVEST_USE_MOCK) {
    const stock = MOCK_STOCKS.find((s) => s.symbol === req.symbol) ?? MOCK_STOCKS[0];
    const price = req.limit_price_kobo || stock.quote.price_kobo;
    const gross = Math.round(req.quantity * price);
    const fees = Math.max(Math.round(gross * 0.015), 10_000);
    const order: Order = {
      id: 'mock-' + Date.now(), symbol: req.symbol, side: 'sell', order_type: req.order_type ?? 'market',
      amount_kobo: gross, quantity: req.quantity, limit_price_kobo: req.limit_price_kobo ?? 0,
      estimated_price_kobo: price, executed_price_kobo: price, filled_quantity: req.quantity,
      fees_kobo: fees, total_amount_kobo: gross - fees, status: 'PendingSettlement',
      provider_reference: 'msk_mock', created_at: new Date().toISOString(),
    };
    return waitMock({ order, risk_disclosure: 'Stock prices can rise or fall. This is not financial advice.', settlement_note: `Proceeds become available after T+${stock.settlement_days} settlement.` });
  }
  return investPost<Receipt>('/stocks/orders/sell', req, idempotencyKey);
}

export async function listOrders(status?: string): Promise<Order[]> {
  if (INVEST_USE_MOCK) return waitMock(MOCK_ORDERS);
  return investGet<Order[]>('/stocks/orders', { status });
}

export async function getOrder(id: string): Promise<Order> {
  if (INVEST_USE_MOCK) return waitMock(MOCK_ORDERS[0]);
  return investGet<Order>(`/stocks/orders/${id}`);
}

export async function cancelOrder(id: string): Promise<Order> {
  if (INVEST_USE_MOCK) return waitMock({ ...MOCK_ORDERS[0], status: 'Cancelled' });
  return investPost<Order>(`/stocks/orders/${id}/cancel`);
}

// ── Portfolio / wallet ───────────────────────────────────────────────────────

export async function getPortfolio(): Promise<PortfolioView> {
  if (INVEST_USE_MOCK) return waitMock(MOCK_PORTFOLIO);
  return investGet<PortfolioView>('/invest/portfolio');
}

export async function getWallet(): Promise<WalletView> {
  if (INVEST_USE_MOCK) return waitMock(MOCK_WALLET);
  return investGet<WalletView>('/invest/wallet');
}

export async function depositToWallet(amountKobo: number, idempotencyKey: string): Promise<WalletView> {
  if (INVEST_USE_MOCK) return waitMock({ ...MOCK_WALLET, available_cash_kobo: MOCK_WALLET.available_cash_kobo + amountKobo });
  return investPost<WalletView>('/invest/wallet/deposit', { amount_kobo: amountKobo, source: 'paymax_wallet' }, idempotencyKey);
}

export async function withdrawFromWallet(amountKobo: number, idempotencyKey: string): Promise<WalletView> {
  if (INVEST_USE_MOCK) return waitMock({ ...MOCK_WALLET, available_cash_kobo: Math.max(0, MOCK_WALLET.available_cash_kobo - amountKobo) });
  return investPost<WalletView>('/invest/wallet/withdraw', { amount_kobo: amountKobo, destination: 'paymax_wallet' }, idempotencyKey);
}

// ── Watchlists ───────────────────────────────────────────────────────────────

export async function getWatchlists(): Promise<Watchlist[]> {
  if (INVEST_USE_MOCK) return waitMock(MOCK_WATCHLISTS);
  return investGet<Watchlist[]>('/invest/watchlists');
}

export async function addToWatchlist(watchlistId: string, symbol: string): Promise<void> {
  if (INVEST_USE_MOCK) return waitMock(undefined);
  await investPost(`/invest/watchlists/${watchlistId}/stocks`, { symbol });
}

export async function removeFromWatchlist(watchlistId: string, assetId: string): Promise<void> {
  if (INVEST_USE_MOCK) return waitMock(undefined);
  await investDelete(`/invest/watchlists/${watchlistId}/stocks/${assetId}`);
}

// ── Public offers ────────────────────────────────────────────────────────────

export async function listPublicOffers(): Promise<PublicOffer[]> {
  if (INVEST_USE_MOCK) return waitMock(MOCK_PUBLIC_OFFERS);
  return investGet<PublicOffer[]>('/invest/public-offers');
}
