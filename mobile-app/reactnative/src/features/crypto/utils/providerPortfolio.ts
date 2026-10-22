// Portfolio on the provider rail: holdings are the crypto in the user's Quidax
// sub-account (GET /crypto/swaps/balances), valued at the indicative asset price.
// Cost basis is NOT known on this rail, so gain/loss is reported as unknown rather
// than as a fabricated ₦0 / 0%. Pure (types only), so it runs under node --test.

import type { CryptoAsset, CryptoPortfolio, Position } from '../types/crypto.types';

export interface BalanceRow { asset: string; available: string; locked: string; total: string }

/** Decimal units → integer minor units at `decimals`, FLOORED (never overstate a holding). */
export function unitsToMinor(units: string, decimals: number): number {
  const m = /^([0-9]+)(?:\.([0-9]+))?$/.exec(units.trim());
  if (!m) return 0;
  const frac = (m[2] ?? '').slice(0, decimals).padEnd(decimals, '0');
  const n = Number(`${m[1]}${frac}`.replace(/^0+(?=\d)/, ''));
  return Number.isSafeInteger(n) ? n : 0;
}

/** Integer minor units → exact decimal string (for a sell request). */
export function minorToUnits(minor: number, decimals: number): string {
  if (!Number.isSafeInteger(minor) || minor <= 0) return '0';
  const s = String(minor).padStart(decimals + 1, '0');
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

export function portfolioFromBalances(
  balances: BalanceRow[],
  assets: CryptoAsset[],
  cashKobo: number,
): CryptoPortfolio {
  const bySymbol = new Map(assets.map((a) => [a.symbol.toUpperCase(), a]));
  const positions: Position[] = [];
  let total = 0;
  let day = 0;
  for (const b of balances) {
    const a = bySymbol.get(b.asset.toUpperCase());
    if (!a) continue; // an asset the app doesn't list can't be valued; never guess a price
    const qty = unitsToMinor(b.total, a.decimals);
    if (qty <= 0) continue;
    const value = Math.floor((qty / 10 ** a.decimals) * a.price.amount);
    total += value;
    day += Math.round((value * a.change24hPct) / (100 + a.change24hPct));
    positions.push({
      assetId: a.id, symbol: a.symbol, name: a.name, iconColor: a.iconColor, riskRating: a.riskRating,
      quantity: { amount: qty, symbol: a.symbol },
      averageCost: { amount: 0, currency: a.price.currency },
      marketValue: { amount: value, currency: a.price.currency },
      costBasis: { amount: 0, currency: a.price.currency },
      unrealizedGainLoss: { amount: 0, currency: a.price.currency },
      unrealizedPct: 0,
      price: a.price,
      change24hPct: a.change24hPct,
      costUnknown: true,
      availableUnits: b.available,
    });
  }
  positions.sort((x, y) => y.marketValue.amount - x.marketValue.amount);
  const prev = total - day;
  return {
    baseCurrency: 'NGN',
    totalValue: { amount: total, currency: 'NGN' },
    totalCostBasis: { amount: 0, currency: 'NGN' },
    totalGainLoss: { amount: 0, currency: 'NGN' },
    totalGainLossPct: 0,
    dayChange: { amount: day, currency: 'NGN' },
    dayChangePct: prev > 0 ? +((day / prev) * 100).toFixed(2) : 0,
    investableBalance: { amount: Math.max(0, cashKobo), currency: 'NGN' },
    positions,
    costUnknown: true,
  };
}

/**
 * The server quote request for what the user typed on the entry screen. A buy is always
 * priced in NGN and a sell always in crypto units (that is what the provider quotes);
 * the other basis is converted at the indicative price, and the SERVER's quote shows the
 * real figures before anything is confirmed. Returns null for a non-positive amount.
 */
export function quoteInputFor(
  side: 'buy' | 'sell',
  basis: 'fiat' | 'crypto',
  amountMinor: number,
  asset: { symbol: string; decimals: number; price: { amount: number } },
): { side: 'buy'; asset: string; ngnKobo: number } | { side: 'sell'; asset: string; amount: string } | null {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  const unit = 10 ** asset.decimals;
  if (side === 'buy') {
    const ngnKobo = basis === 'fiat' ? amountMinor : Math.floor((amountMinor / unit) * asset.price.amount);
    return ngnKobo > 0 ? { side, asset: asset.symbol, ngnKobo } : null;
  }
  const minor = basis === 'crypto'
    ? amountMinor
    : asset.price.amount > 0 ? Math.floor((amountMinor / asset.price.amount) * unit) : 0;
  const amount = minorToUnits(minor, asset.decimals);
  return amount !== '0' ? { side, asset: asset.symbol, amount } : null;
}
