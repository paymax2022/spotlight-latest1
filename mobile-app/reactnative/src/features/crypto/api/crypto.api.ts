// ── Paymax Invest · Crypto — API wrapper ─────────────────────────────────────
// Typed data layer the screens code against (Backend role owns this file).
// Mirrors fx.api.ts: mock-flagged. Flip EXPO_PUBLIC_CRYPTO_USE_MOCK=false once
// the real Paymax /api/v1/crypto endpoints (docs/crypto/api.md) land.
//
// IRON RULES honoured here (docs/crypto/architecture.md):
//  • all money is integer minor units;
//  • every buy/sell carries an Idempotency-Key (Rule 6);
//  • execution runs against a server quote id — price is never assumed (Rule 2);
//  • the client never computes fees/eligibility authoritatively — server wins.

import { api } from '@/api/client';
import { buildQuote, buildSwapQuote } from '../utils/cryptoFormatters';
import {
  MOCK_ASSETS,
  MOCK_POSITIONS,
  MOCK_TRANSACTIONS,
} from './crypto.mock';
import type {
  AddressScreening,
  CandlePoint,
  ChartRange,
  CryptoAddress,
  CryptoAsset,
  DepositAddress,
  CryptoEligibility,
  CryptoOrder,
  CryptoPortfolio,
  CryptoQuote,
  CryptoTransactionDetail,
  CryptoTransactionSummary,
  FiatCurrency,
  NewAddressDraft,
  NewPriceAlertDraft,
  Position,
  PriceAlert,
  QuoteRequest,
  SwapDraft,
  SwapQuote,
  SwapResult,
  WithdrawalDraft,
  WithdrawalEligibility,
  WithdrawalQuote,
  WithdrawalResult,
} from '../types/crypto.types';

// ─── Feature flag: flip to false once real endpoints are ready ────────────────
const USE_MOCK = (process.env.EXPO_PUBLIC_CRYPTO_USE_MOCK ?? 'true').toLowerCase() !== 'false';

/** Simulated network latency so loading states render in mock mode. */
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;

/**
 * Normalise a thrown axios error into an Error carrying the Go backend's real
 * message + error `type`. The Go API returns `{ type, code, message }` with a
 * non-2xx status; surface `message` to the screens and preserve `type` (e.g.
 * 'quote_expired') on `cryptoType` so the special-case path still works.
 */
function toCryptoError(err: unknown): Error {
  const e = err as { response?: { data?: { type?: string; message?: string } }; message?: string };
  const data = e?.response?.data;
  const msg = data?.message ?? e?.message ?? 'Something went wrong. Please try again.';
  const out = new Error(msg) as Error & { cryptoType?: string };
  if (data?.type) out.cryptoType = data.type;       // e.g. 'quote_expired'
  return out;
}

function requireAsset(assetId: string): CryptoAsset {
  const asset = MOCK_ASSETS.find((a) => a.id === assetId || a.symbol === assetId);
  if (!asset) throw new Error('Asset not found');
  return asset;
}

// ─── Eligibility (server-side gate; docs/crypto/compliance.md) ────────────────

export async function getEligibility(): Promise<CryptoEligibility> {
  if (USE_MOCK) {
    await delay(160);
    // Mock: a fully-verified, eligible user. Other states are reachable by
    // changing the returned `state` here while wiring the gated UI.
    return {
      state: 'eligible',
      kycTier: 2,
      cryptoEnabled: true,
      message: 'You\'re verified and cleared to trade crypto.',
    };
  }
  return unwrap<CryptoEligibility>(await api.get('/api/v1/invest/eligibility'));
}

// ─── Assets (GET /crypto/assets, /crypto/assets/:symbol) ──────────────────────

export async function getAssets(): Promise<CryptoAsset[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_ASSETS]; }
  return unwrap<CryptoAsset[]>(await api.get('/api/v1/crypto/assets'));
}

// MISSING backend endpoint: GET /crypto/assets/:symbol (single-asset detail).
// The backend only exposes the list route; find the asset client-side.
export async function getAsset(symbol: string): Promise<CryptoAsset> {
  if (USE_MOCK) { await delay(220); return requireAsset(symbol); }
  const assets = await getAssets();
  const found = assets.find((a) => a.id === symbol || a.symbol === symbol);
  if (!found) throw new Error('Asset not found');
  return found;
}

/** Deterministic mock price history for the asset chart. */
export async function getChart(symbol: string, range: ChartRange): Promise<CandlePoint[]> {
  if (USE_MOCK) {
    await delay(240);
    const asset = requireAsset(symbol);
    const points = { '1H': 30, '1D': 24, '1W': 28, '1M': 30, '1Y': 52 }[range];
    const stepMs = {
      '1H': 120_000, '1D': 3_600_000, '1W': 6 * 3_600_000,
      '1M': 86_400_000, '1Y': 7 * 86_400_000,
    }[range];
    const base = asset.price.amount;
    const seed = (symbol + range).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const amp = asset.riskRating === 'high' ? 0.06 : asset.riskRating === 'medium' ? 0.035 : 0.004;
    return Array.from({ length: points }).map((_, i) => {
      const wobble = Math.sin((seed + i) / 3) * amp + Math.cos((seed + i) / 6) * amp * 0.6;
      const drift = (asset.change24hPct / 100) * (i / points);
      return {
        t: new Date(Date.now() - (points - i) * stepMs).toISOString(),
        price: Math.max(1, Math.round(base * (1 + wobble + drift - amp / 2))),
      };
    });
  }
  // MISSING backend endpoint: GET /crypto/assets/:symbol/chart (price history).
  return unwrap<CandlePoint[]>(await api.get(`/api/v1/crypto/assets/${symbol}/chart`, { params: { range } }));
}

// ─── Quote (GET /crypto/assets/:id/quote) ─────────────────────────────────────
// NOTE: the backend quote route is a GET on the asset (no swap/side inputs);
// it re-prices server-side at execution time regardless, so this is display-only.

export async function createQuote(req: QuoteRequest): Promise<CryptoQuote> {
  if (USE_MOCK) { await delay(380); return buildQuote(requireAsset(req.assetId), req); }
  return unwrap<CryptoQuote>(await api.get(`/api/v1/crypto/assets/${req.assetId}/quote`));
}

// ─── Execute buy / sell (POST /crypto/buy, /crypto/sell) ──────────────────────
// Money mutations → server-side pre-trade check + Idempotency-Key + provider ref.

async function executeMock(quote: CryptoQuote, idempotencyKey: string): Promise<CryptoOrder> {
  await delay(1100);
  // Simulate the expired-quote rejection so the re-quote path is reachable.
  if (new Date(quote.expiresAt).getTime() < Date.now()) {
    const err = new Error('The quote expired before the order could be filled.') as Error & { cryptoType?: string };
    err.cryptoType = 'quote_expired';
    throw err;
  }
  const now = new Date().toISOString();
  return {
    id: `co_${Date.now()}`,
    reference: `PMX-CR-${Date.now().toString().slice(-6)}`,
    assetId: quote.assetId,
    symbol: quote.symbol,
    side: quote.side,
    status: 'Filled',
    fiat: quote.fiat,
    crypto: quote.crypto,
    allInRate: quote.allInRate,
    fees: quote.fees,
    totalFiat: quote.totalFiat,
    provider: quote.liquidityProvider,
    providerReference: `LP-${Date.now().toString().slice(-5)}-XY`,
    idempotencyKey,
    transactionId: `cx_${Date.now()}`,
    createdAt: now,
  };
}

export async function executeBuy(quote: CryptoQuote, idempotencyKey: string): Promise<CryptoOrder> {
  if (USE_MOCK) return executeMock(quote, idempotencyKey);
  // The server re-prices from asset_id/cash_kobo (never trusts the client's
  // price or fees), executes the pre-trade check + ledger, and returns the
  // authoritative order. Idempotency-Key makes the POST safely retryable.
  try {
    const res = await api.post(
      '/api/v1/crypto/orders/buy',
      { asset_id: quote.assetId, cash_kobo: quote.totalFiat.amount },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    const body = unwrap<{ order: CryptoOrder }>(res);
    return (body as unknown as { order?: CryptoOrder }).order ?? (body as unknown as CryptoOrder);
  } catch (err) {
    throw toCryptoError(err);
  }
}

export async function executeSell(quote: CryptoQuote, idempotencyKey: string): Promise<CryptoOrder> {
  if (USE_MOCK) return executeMock(quote, idempotencyKey);
  try {
    const res = await api.post(
      '/api/v1/crypto/orders/sell',
      { asset_id: quote.assetId, units: quote.crypto.amount },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    const body = unwrap<{ order: CryptoOrder }>(res);
    return (body as unknown as { order?: CryptoOrder }).order ?? (body as unknown as CryptoOrder);
  } catch (err) {
    throw toCryptoError(err);
  }
}

// ─── Swap ──────────────────────────────────────────────────────────────────────
// LIVE: crypto-to-crypto swap is now backed by Go — POST /crypto/swap/quote for
// the pre-trade estimate and POST /crypto/swap for the atomic two-leg order
// (sell A → buy B under one Idempotency-Key). The server re-prices at execution;
// the client quote is display-only. Amounts are integer asset minor units.

export async function createSwapQuote(draft: SwapDraft): Promise<SwapQuote> {
  if (USE_MOCK) {
    await delay(360);
    return buildSwapQuote(requireAsset(draft.fromAssetId), requireAsset(draft.toAssetId), draft.fromAmount);
  }
  // POST /crypto/swap/quote → { from_asset_id, to_asset_id, from_units }.
  try {
    return unwrap<SwapQuote>(
      await api.post('/api/v1/crypto/swap/quote', {
        from_asset_id: draft.fromAssetId,
        to_asset_id: draft.toAssetId,
        from_units: draft.fromAmount,
      }),
    );
  } catch (err) {
    throw toCryptoError(err);
  }
}

export async function executeSwap(quote: SwapQuote, idempotencyKey: string): Promise<SwapResult> {
  if (USE_MOCK) {
    await delay(1100);
    if (new Date(quote.expiresAt).getTime() < Date.now()) {
      const err = new Error('The swap quote expired before it could be filled.') as Error & { cryptoType?: string };
      err.cryptoType = 'quote_expired';
      throw err;
    }
    return {
      id: `so_${Date.now()}`,
      reference: `PMX-SW-${Date.now().toString().slice(-6)}`,
      fromSymbol: quote.from.symbol,
      toSymbol: quote.to.symbol,
      status: 'Filled',
      from: quote.from,
      to: quote.to,
      fee: quote.fee,
      provider: quote.liquidityProvider,
      providerReference: `LP-${Date.now().toString().slice(-5)}-SW`,
      idempotencyKey,
      transactionId: `cx_${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
  }
  // POST /crypto/swap → { from_asset_id, to_asset_id, from_units }. The server
  // re-prices from these inputs (never trusts the client fee/rate) and returns the
  // authoritative filled swap order. Idempotency-Key makes the POST retry-safe.
  try {
    return unwrap<SwapResult>(
      await api.post(
        '/api/v1/crypto/swap',
        {
          from_asset_id: quote.fromAssetId,
          to_asset_id: quote.toAssetId,
          from_units: quote.from.amount,
        },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      ),
    );
  } catch (err) {
    throw toCryptoError(err);
  }
}

// ─── Portfolio (GET /portfolio, /portfolio/positions) ─────────────────────────

export async function getPortfolio(): Promise<CryptoPortfolio> {
  if (USE_MOCK) {
    await delay(280);
    const positions = [...MOCK_POSITIONS];
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
      investableBalance: { amount: Math.round(842_500 * 100), currency: 'NGN' },
      positions,
    };
  }
  return unwrap<CryptoPortfolio>(await api.get('/api/v1/crypto/portfolio'));
}

export async function getPositions(): Promise<Position[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_POSITIONS]; }
  return unwrap<Position[]>(await api.get('/api/v1/crypto/portfolio/holdings'));
}

// ─── Transactions ──────────────────────────────────────────────────────────────
// MISSING backend endpoints: no /crypto/transactions list/detail route — only
// GET /crypto/orders (own order history) exists. Reusing it as the closest
// live analogue; per-transaction detail (id lookup) stays mock until the
// backend ships GET /crypto/transactions/:id.

export async function getTransactions(side?: 'buy' | 'sell'): Promise<CryptoTransactionSummary[]> {
  if (USE_MOCK) {
    await delay();
    let list = [...MOCK_TRANSACTIONS];
    if (side) list = list.filter((t) => t.side === side);
    return list
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .map(({ allInRate, fees, totalFiat, provider, providerReference, liquidityProvider, custodyProvider, statusHistory, failureReason, ...summary }) => summary);
  }
  const res = await api.get('/api/v1/crypto/orders');
  const body = unwrap<{ orders: CryptoTransactionSummary[] }>(res);
  let list = (body as unknown as { orders?: CryptoTransactionSummary[] }).orders ?? (body as unknown as CryptoTransactionSummary[]);
  if (side) list = list.filter((t) => t.side === side);
  return list;
}

export async function getTransaction(id: string): Promise<CryptoTransactionDetail> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_TRANSACTIONS.find((t) => t.id === id || t.reference === id);
    if (!found) throw new Error('Transaction not found');
    return found;
  }
  const list = await getTransactions();
  const found = (list as unknown as CryptoTransactionDetail[]).find((t) => t.id === id || t.reference === id);
  if (!found) throw new Error('Transaction not found');
  return found;
}

// ─── Deposit address (GET /crypto/deposit-address) ────────────────────────────
// LIVE: GET /crypto/deposit-address?asset=<symbol>&network=<net> returns the
// caller's per-asset deposit address, generated + persisted on first request via
// the custody provider seam (stable across calls). Mock keeps a deterministic
// address so the same asset/network always renders the same QR offline.

export async function getDepositAddress(symbol: string, networkId: string): Promise<DepositAddress> {
  if (USE_MOCK) {
    await delay(420);
    const asset = requireAsset(symbol);
    const network = asset.supportedNetworks.find((n) => n.id === networkId) ?? asset.supportedNetworks[0];
    // Deterministic pseudo-address from symbol+network (display only).
    const seed = `${asset.symbol}-${network.id}`.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const body = Math.abs(seed * 2654435761).toString(36).padEnd(30, '0').slice(0, 30);
    const prefix = network.id === 'bitcoin' ? 'bc1q' : network.id === 'tron' ? 'T' : '0x';
    // Tron-style networks use a destination memo/tag in this mock.
    const needsMemo = network.id === 'tron';
    return {
      symbol: asset.symbol,
      networkId: network.id, networkName: network.name,
      address: `${prefix}${body}`,
      memo: needsMemo ? String(100000 + (seed % 900000)) : undefined,
      minDeposit: { amount: Math.round(10 ** asset.decimals * 0.0001), symbol: asset.symbol },
      confirmations: network.confirmations,
      custodyProvider: 'mock-custody',
    };
  }
  return unwrap<DepositAddress>(await api.get('/api/v1/crypto/deposit-address', { params: { symbol, network: networkId } }));
}

// ─── Watchlist (GET/POST/DELETE /watchlists) ──────────────────────────────────
// Mock keeps a single default watchlist as a set of asset ids. Reads return the
// resolved assets so the screens can render rows without a second round-trip.
// The only live watchlist surface on the backend is invest's shared
// /invest/watchlists (list container + POST/DELETE …/stocks entries); crypto
// reuses the "default" list id as its container. Shape differs slightly
// (symbol-keyed here vs asset-id there) so this maps through best-effort.

const MOCK_WATCHLIST = new Set<string>(['ast_btc', 'ast_sol']);

export async function getWatchlist(): Promise<CryptoAsset[]> {
  if (USE_MOCK) {
    await delay(200);
    return MOCK_ASSETS.filter((a) => MOCK_WATCHLIST.has(a.id));
  }
  return unwrap<CryptoAsset[]>(await api.get('/api/v1/invest/watchlists'));
}

export async function addToWatchlist(assetId: string): Promise<void> {
  if (USE_MOCK) { await delay(180); MOCK_WATCHLIST.add(assetId); return; }
  await api.post('/api/v1/invest/watchlists/default/stocks', { symbol: assetId });
}

export async function removeFromWatchlist(assetId: string): Promise<void> {
  if (USE_MOCK) { await delay(180); MOCK_WATCHLIST.delete(assetId); return; }
  await api.delete(`/api/v1/invest/watchlists/default/stocks/${assetId}`);
}

// ─── Price alerts (GET/POST/PATCH/DELETE /alerts) ─────────────────────────────
// Reuses invest's shared /invest/alerts surface (cross-asset price alerts).

const ngn = (major: number) => Math.round(major * 100);
const MOCK_ALERTS: PriceAlert[] = [
  {
    id: 'al_1', assetId: 'ast_btc', symbol: 'BTC', iconColor: '#F7931A',
    condition: 'above', targetPrice: { amount: ngn(100_000_000), currency: 'NGN' },
    status: 'active', triggeredAt: null,
    createdAt: new Date(Date.now() - 36 * 3_600_000).toISOString(),
  },
  {
    id: 'al_2', assetId: 'ast_eth', symbol: 'ETH', iconColor: '#627EEA',
    condition: 'below', targetPrice: { amount: ngn(5_000_000), currency: 'NGN' },
    status: 'active', triggeredAt: null,
    createdAt: new Date(Date.now() - 8 * 3_600_000).toISOString(),
  },
];

export async function getAlerts(): Promise<PriceAlert[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_ALERTS].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return unwrap<PriceAlert[]>(await api.get('/api/v1/invest/alerts'));
}

export async function createAlert(draft: NewPriceAlertDraft): Promise<PriceAlert> {
  if (USE_MOCK) {
    await delay(360);
    const asset = requireAsset(draft.assetId);
    const created: PriceAlert = {
      id: `al_${Date.now()}`,
      assetId: asset.id, symbol: asset.symbol, iconColor: asset.iconColor,
      condition: draft.condition,
      targetPrice: { amount: draft.targetPrice, currency: draft.currency },
      status: 'active', triggeredAt: null, createdAt: new Date().toISOString(),
    };
    MOCK_ALERTS.unshift(created);
    return created;
  }
  return unwrap<PriceAlert>(await api.post('/api/v1/invest/alerts', draft));
}

export async function deleteAlert(id: string): Promise<void> {
  if (USE_MOCK) {
    await delay(200);
    const i = MOCK_ALERTS.findIndex((a) => a.id === id);
    if (i >= 0) MOCK_ALERTS.splice(i, 1);
    return;
  }
  await api.delete(`/api/v1/invest/alerts/${id}`);
}

// ─── Withdrawal address book (Phase-4; docs/crypto/compliance.md) ─────────────
// Every destination is whitelisted + screened before first use. Addresses are
// masked in the UI; the full value is only shown on the detail/confirm screens.
// LIVE: the address allow-list + withdrawal state machine are now backed by Go —
// GET/POST/DELETE /crypto/addresses (whitelist) and POST/GET /crypto/withdrawals
// (requested→pending→broadcast→confirmed|failed via a pluggable provider seam).
// screenAddress + getWithdrawalEligibility remain mock (compliance surfaces the
// backend does not expose yet); the whitelist itself is enforced server-side.

const MOCK_ADDRESSES: CryptoAddress[] = [
  {
    id: 'addr_1', label: 'My Ledger', symbol: 'BTC',
    networkId: 'bitcoin', networkName: 'Bitcoin',
    address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    whitelisted: true, screened: true,
    addedAt: new Date(Date.now() - 9 * 86_400_000).toISOString(),
  },
  {
    id: 'addr_2', label: 'Binance USDT', symbol: 'USDT',
    networkId: 'tron', networkName: 'Tron (TRC-20)',
    address: 'TJ8s3sB1kY7Yb9aQ2cZx4pN6mWvL1rGq5d',
    whitelisted: true, screened: true,
    addedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  },
];

export async function getAddresses(symbol?: string): Promise<CryptoAddress[]> {
  if (USE_MOCK) {
    await delay(220);
    const list = symbol ? MOCK_ADDRESSES.filter((a) => a.symbol === symbol) : MOCK_ADDRESSES;
    return [...list].sort((a, b) => +new Date(b.addedAt) - +new Date(a.addedAt));
  }
  return unwrap<CryptoAddress[]>(await api.get('/api/v1/crypto/addresses', { params: { symbol } }));
}

/** Screen an address for AML/sanctions risk before whitelisting (mock heuristic). */
export async function screenAddress(address: string): Promise<AddressScreening> {
  if (USE_MOCK) {
    await delay(600);
    // Mock: flag obviously malformed/short addresses so the blocked path is reachable.
    if (address.replace(/\s/g, '').length < 12) {
      return { risk: 'flagged', reason: 'This address failed validation. Check you copied the full address.' };
    }
    return { risk: 'clear' };
  }
  return unwrap<AddressScreening>(await api.post('/api/v1/crypto/addresses/screen', { address }));
}

export async function addAddress(draft: NewAddressDraft): Promise<CryptoAddress> {
  if (USE_MOCK) {
    await delay(500);
    const asset = requireAsset(draft.symbol);
    const network = asset.supportedNetworks.find((n) => n.id === draft.networkId) ?? asset.supportedNetworks[0];
    const created: CryptoAddress = {
      id: `addr_${Date.now()}`,
      label: draft.label || 'Saved address',
      symbol: draft.symbol,
      networkId: network.id, networkName: network.name,
      address: draft.address,
      whitelisted: true, screened: true,
      addedAt: new Date().toISOString(),
    };
    MOCK_ADDRESSES.unshift(created);
    return created;
  }
  // POST /crypto/addresses → { symbol, label, network, address }. Server whitelists
  // the destination (allow-list) and screens it; withdrawals must target a saved one.
  try {
    return unwrap<CryptoAddress>(
      await api.post('/api/v1/crypto/addresses', {
        symbol: draft.symbol,
        label: draft.label,
        network: draft.networkId,
        address: draft.address,
      }),
    );
  } catch (err) {
    throw toCryptoError(err);
  }
}

export async function deleteAddress(id: string): Promise<void> {
  if (USE_MOCK) {
    await delay(200);
    const i = MOCK_ADDRESSES.findIndex((a) => a.id === id);
    if (i >= 0) MOCK_ADDRESSES.splice(i, 1);
    return;
  }
  await api.delete(`/api/v1/crypto/addresses/${id}`);
}

// ─── Withdrawal eligibility + quote + execution ───────────────────────────────

export async function getWithdrawalEligibility(): Promise<WithdrawalEligibility> {
  if (USE_MOCK) {
    await delay(180);
    // Mock: a Tier-2 user, cleared, but every crypto withdrawal goes to manual
    // review per the MVP rule (docs/crypto/product.md, Phase 3).
    return {
      gate: 'eligible',
      kycTier: 2,
      manualReviewOnly: true,
      dailyLimit: { amount: ngn(5_000_000), currency: 'NGN' },
      dailyUsed: { amount: ngn(0), currency: 'NGN' },
      manualReviewThreshold: { amount: ngn(500_000), currency: 'NGN' },
      message: 'Withdrawals are reviewed by compliance before broadcast.',
    };
  }
  return unwrap<WithdrawalEligibility>(await api.get('/api/v1/crypto/withdrawals/eligibility'));
}

/** Estimate the in-asset network fee + build a withdrawal preview. */
export async function quoteWithdrawal(draft: WithdrawalDraft): Promise<WithdrawalQuote> {
  if (USE_MOCK) {
    await delay(360);
    const asset = requireAsset(draft.assetId);
    const network = asset.supportedNetworks.find((n) => n.id === draft.networkId) ?? asset.supportedNetworks[0];
    const unit = 10 ** asset.decimals;
    // Network fee ~0.05% of amount, floored at a tiny base — illustrative only.
    const networkFeeMinor = Math.max(Math.round(unit * 0.00005), Math.round(draft.amount * 0.0005));
    const receive = Math.max(0, draft.amount - networkFeeMinor);
    const fiatValue = Math.round((draft.amount / unit) * asset.price.amount);
    return {
      symbol: asset.symbol,
      networkId: network.id, networkName: network.name,
      amount: { amount: draft.amount, symbol: asset.symbol },
      networkFee: { amount: networkFeeMinor, symbol: asset.symbol },
      paymaxFee: { amount: ngn(150), currency: 'NGN' },
      receiveAmount: { amount: receive, symbol: asset.symbol },
      fiatValue: { amount: fiatValue, currency: 'NGN' },
      requiresManualReview: true,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }
  // POST /crypto/withdrawals/quote → { symbol, network, units }. Returns the
  // in-asset network fee + net receive preview (server re-computes at fill time).
  return unwrap<WithdrawalQuote>(
    await api.post('/api/v1/crypto/withdrawals/quote', {
      symbol: draft.symbol,
      network: draft.networkId,
      units: draft.amount,
    }),
  );
}

/** Initiate a withdrawal — server-side pre-check + Idempotency-Key + provider ref. */
export async function initiateWithdrawal(
  draft: WithdrawalDraft,
  quote: WithdrawalQuote,
  otp: string,
  idempotencyKey: string,
): Promise<WithdrawalResult> {
  if (USE_MOCK) {
    await delay(1200);
    const addr = MOCK_ADDRESSES.find((a) => a.id === draft.addressId);
    // Manual-review terminal state for MVP (never broadcast straight away).
    return {
      id: `wd_${Date.now()}`,
      reference: `PMX-WD-${Date.now().toString().slice(-6)}`,
      symbol: quote.symbol,
      status: 'WithdrawalPendingReview',
      amount: quote.amount,
      networkFee: quote.networkFee,
      address: addr?.address ?? '',
      networkName: quote.networkName,
      providerReference: `CU-${Date.now().toString().slice(-5)}-WD`,
      idempotencyKey,
      estimatedReviewMins: 30,
      createdAt: new Date().toISOString(),
    };
  }
  // POST /crypto/withdrawals → { symbol, address_id, units, fee_kobo }. The server
  // validates the address is a saved, active, whitelisted destination (allow-list),
  // debits+parks the holding units (no mint), charges the fiat fee to revenue, and
  // drives the state machine requested→pending→broadcast via the provider seam.
  // Idempotency-Key makes the POST retry-safe. (otp is a client-side confirmation
  // gate; the backend authorises via the whitelist + session identity.)
  void otp;
  try {
    return unwrap<WithdrawalResult>(
      await api.post(
        '/api/v1/crypto/withdrawals',
        {
          symbol: quote.symbol,
          address_id: draft.addressId,
          units: draft.amount,
          fee_kobo: quote.paymaxFee.amount,
        },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      ),
    );
  } catch (err) {
    throw toCryptoError(err);
  }
}
