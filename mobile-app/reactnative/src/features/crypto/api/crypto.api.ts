// Typed data layer the crypto screens code against. Every call goes to the Paymax
// /api/v1 crypto endpoints, which are backed by Quidax. There is no mock path.
// IRON RULES honoured here (docs/crypto/architecture.md):
//  • the client never computes fees/eligibility authoritatively — server wins.

import { api } from '@/api/client';
import { unwrapEnvelope } from '../utils/envelope';
import type {
  FiatMoney,
  AddressScreening,
  CandlePoint,
  ChartRange,
  CryptoAddress,
  CryptoAsset,
  CryptoDepositRecord,
  DepositAddress,
  CryptoEligibility,
  CryptoOrder,
  CryptoPortfolio,
  CryptoQuote,
  CryptoTransactionDetail,
  CryptoTransactionSummary,
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

// The Go crypto handlers wrap every 2xx body as { success: true, <namedKey>: value }
// (order / portfolio / assets / swap / …), not under `data`. Unwrap the single
// payload key so the screens get the payload, not the envelope. See envelope.ts.
const unwrap = <T>(res: { data: unknown }): T => unwrapEnvelope<T>(res?.data);

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

export async function getEligibility(): Promise<CryptoEligibility> {
  return unwrap<CryptoEligibility>(await api.get('/api/v1/crypto/eligibility'));
}

export async function getAssets(): Promise<CryptoAsset[]> {
  return unwrap<CryptoAsset[]>(await api.get('/api/v1/crypto/assets'));
}

// There is no single-asset route on the backend, so the asset is found in the list.
export async function getAsset(symbol: string): Promise<CryptoAsset> {
  const assets = await getAssets();
  const found = assets.find((a) => a.id === symbol || a.symbol === symbol);
  if (!found) throw new Error('Asset not found');
  return found;
}

/** Price history for the asset chart. */
export async function getChart(symbol: string, range: ChartRange): Promise<CandlePoint[]> {
  return unwrap<CandlePoint[]>(await api.get(`/api/v1/crypto/assets/${symbol}/chart`, { params: { range } }));
}

// The backend quote route is a GET on the asset (no swap/side inputs); it re-prices
// server-side at execution time regardless, so this is display-only.
export async function createQuote(req: QuoteRequest): Promise<CryptoQuote> {
  return unwrap<CryptoQuote>(await api.get(`/api/v1/crypto/assets/${req.assetId}/quote`));
}

// Money mutations → server-side pre-trade check + Idempotency-Key + provider ref.

export async function executeBuy(quote: CryptoQuote, idempotencyKey: string): Promise<CryptoOrder> {
  // The server re-prices from asset_id/cash_kobo (never trusts the client's price or
  // fees), executes the pre-trade check + ledger, and returns the authoritative order.
  try {
    const res = await api.post(
      '/api/v1/crypto/orders/buy',
      { asset_id: quote.assetId, cash_kobo: quote.totalFiat.amount },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    return unwrap<CryptoOrder>(res);
  } catch (err) {
    throw toCryptoError(err);
  }
}

export async function executeSell(quote: CryptoQuote, idempotencyKey: string): Promise<CryptoOrder> {
  try {
    const res = await api.post(
      '/api/v1/crypto/orders/sell',
      { asset_id: quote.assetId, units: quote.crypto.amount },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    return unwrap<CryptoOrder>(res);
  } catch (err) {
    throw toCryptoError(err);
  }
}

// The swap quote is display-only; POST /crypto/swap re-prices from its own inputs.
// Amounts are integer asset minor units.
export async function createSwapQuote(draft: SwapDraft): Promise<SwapQuote> {
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
  // POST /crypto/swap → { from_asset_id, to_asset_id, from_units }. The server re-prices
  // from these inputs (never trusts the client fee/rate) and returns the authoritative
  // filled swap order. Idempotency-Key makes the POST retry-safe.
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

// The backend returns holdings in snake_case with the NGN value (kobo) per holding and the
// total. It does not yet carry cost basis, day change, price or the investable balance, so
// those fields are zero until the backend provides them.
type HoldingWire = { asset_id: string; symbol: string; units: number; value_kobo: number };
type PortfolioWire = { holdings?: HoldingWire[] | null; total_value_kobo?: number };

const ngnKobo = (amount: number): FiatMoney => ({ amount, currency: 'NGN' });

function mapHolding(h: HoldingWire): Position {
  const value = Number(h.value_kobo) || 0;
  return {
    assetId: h.asset_id,
    symbol: h.symbol,
    name: h.symbol,
    iconColor: '#6B7280',
    riskRating: 'medium',
    quantity: { amount: Number(h.units) || 0, symbol: h.symbol },
    averageCost: ngnKobo(value),
    marketValue: ngnKobo(value),
    costBasis: ngnKobo(value),
    unrealizedGainLoss: ngnKobo(0),
    unrealizedPct: 0,
    price: ngnKobo(0),
    change24hPct: 0,
  };
}

export async function getPortfolio(): Promise<CryptoPortfolio> {
  const wire = unwrap<PortfolioWire>(await api.get('/api/v1/crypto/portfolio'));
  const total = Number(wire?.total_value_kobo) || 0;
  return {
    baseCurrency: 'NGN',
    totalValue: ngnKobo(total),
    totalCostBasis: ngnKobo(total),
    totalGainLoss: ngnKobo(0),
    totalGainLossPct: 0,
    dayChange: ngnKobo(0),
    dayChangePct: 0,
    investableBalance: ngnKobo(0),
    positions: (wire?.holdings ?? []).map(mapHolding),
  };
}

export async function getPositions(): Promise<Position[]> {
  const list = unwrap<HoldingWire[] | null>(await api.get('/api/v1/crypto/portfolio/holdings'));
  return (list ?? []).map(mapHolding);
}

// The backend has no transactions list route; GET /crypto/orders (own order history)
// is the closest one, so the list and the detail both read from it.
export async function getTransactions(side?: 'buy' | 'sell'): Promise<CryptoTransactionSummary[]> {
  const res = await api.get('/api/v1/crypto/orders');
  const list = unwrap<CryptoTransactionSummary[]>(res);
  // Ensure we have an array even if the response is null/undefined
  const arr = Array.isArray(list) ? list : [];
  if (side) return arr.filter((t) => t.side === side);
  return arr;
}

export async function getTransaction(id: string): Promise<CryptoTransactionDetail> {
  const list = await getTransactions();
  const found = (list as unknown as CryptoTransactionDetail[]).find((t) => t.id === id || t.reference === id);
  if (!found) throw new Error('Transaction not found');
  return found;
}

// The caller's per-asset deposit address, generated + persisted on first request by the
// custody provider (stable across calls).
export async function getDepositAddress(symbol: string, networkId: string): Promise<DepositAddress> {
  return unwrap<DepositAddress>(await api.get('/api/v1/crypto/deposit-address', { params: { symbol, network: networkId } }));
}

// Money-IN history. The backend journals a crypto_deposits row only once a transfer clears
// its confirmation floor and is credited exactly once, so any record returned here is
// already settled. The Go wire shape is snake_case; normalise to the screen's camelCase record.

type DepositWire = {
  id: string; provider: string; provider_op_id: string; symbol: string; network: string;
  address?: string; units: number; minor_unit_scale: number; confirmations: number;
  required_confs: number; tx_hash?: string; created_at: string; credited_at: string;
};

function mapDeposit(d: DepositWire): CryptoDepositRecord {
  return {
    id: d.id, provider: d.provider, providerOpId: d.provider_op_id, symbol: d.symbol, network: d.network,
    address: d.address, units: Number(d.units), minorUnitScale: Number(d.minor_unit_scale) || 1,
    confirmations: Number(d.confirmations), requiredConfs: Number(d.required_confs),
    txHash: d.tx_hash, createdAt: d.created_at, creditedAt: d.credited_at,
    credited: Number(d.confirmations) >= Number(d.required_confs),
  };
}

export async function getDeposits(symbol?: string): Promise<CryptoDepositRecord[]> {
  const res = await api.get('/api/v1/crypto/deposits', { params: symbol ? { symbol } : undefined });
  const list = unwrap<DepositWire[]>(res);
  return (Array.isArray(list) ? list : []).map(mapDeposit);
}

export async function getDeposit(id: string): Promise<CryptoDepositRecord> {
  return mapDeposit(unwrap<DepositWire>(await api.get(`/api/v1/crypto/deposits/${id}`)));
}

// The watchlist is invest's shared watchlist, using the "default" list id.
export async function getWatchlist(): Promise<CryptoAsset[]> {
  return unwrap<CryptoAsset[]>(await api.get('/api/v1/crypto/watchlist'));
}

export async function addToWatchlist(assetId: string): Promise<void> {
  await api.post('/api/v1/crypto/watchlist', { assetId });
}

export async function removeFromWatchlist(assetId: string): Promise<void> {
  await api.delete(`/api/v1/crypto/watchlist/${assetId}`);
}

// Price alerts for the crypto assets.

export async function getAlerts(): Promise<PriceAlert[]> {
  return unwrap<PriceAlert[]>(await api.get('/api/v1/crypto/alerts'));
}

export async function createAlert(draft: NewPriceAlertDraft): Promise<PriceAlert> {
  return unwrap<PriceAlert>(await api.post('/api/v1/crypto/alerts', draft));
}

export async function deleteAlert(id: string): Promise<void> {
  await api.delete(`/api/v1/crypto/alerts/${id}`);
}

// Every destination is whitelisted + screened before first use. Addresses are masked in
// the UI; the full value is only shown on the detail/confirm screens.

export async function getAddresses(symbol?: string): Promise<CryptoAddress[]> {
  return unwrap<CryptoAddress[]>(await api.get('/api/v1/crypto/addresses', { params: { symbol } }));
}

/** Screen an address for AML/sanctions risk before whitelisting. */
export async function screenAddress(address: string): Promise<AddressScreening> {
  return unwrap<AddressScreening>(await api.post('/api/v1/crypto/addresses/screen', { address }));
}

export async function addAddress(draft: NewAddressDraft): Promise<CryptoAddress> {
  // POST /crypto/addresses → { symbol, label, network, address }. Server whitelists the
  // destination (allow-list) and screens it; withdrawals must target a saved one.
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
  await api.delete(`/api/v1/crypto/addresses/${id}`);
}

export async function getWithdrawalEligibility(): Promise<WithdrawalEligibility> {
  return unwrap<WithdrawalEligibility>(await api.get('/api/v1/crypto/withdrawals/eligibility'));
}

/** Estimate the in-asset network fee + build a withdrawal preview. */
export async function quoteWithdrawal(draft: WithdrawalDraft): Promise<WithdrawalQuote> {
  // POST /crypto/withdrawals/quote → { symbol, network, units }. Returns the in-asset
  // network fee + net receive preview (the server re-computes at fill time).
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
  // POST /crypto/withdrawals → { symbol, address_id, units, fee_kobo }. The server
  // validates the address is a saved, active, whitelisted destination (allow-list),
  // debits+parks the holding units (no mint), charges the fiat fee to revenue, and drives
  // the state machine requested→pending→broadcast via the provider. Idempotency-Key makes
  // the POST retry-safe. The otp is a client-side confirmation only.
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
