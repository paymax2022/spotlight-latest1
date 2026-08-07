// Pure-logic unit tests for stocks portfolio aggregation (money-path).
// Run: node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs \
//        --test "src/features/stocks/utils/__tests__/*.test.ts"
//
// BUG 2 (mixed-currency total): positions can be priced in NGN (NGX) or USD (US
// stocks). Summing marketValue.amount across currencies with no FX conversion
// adds kobo to cents and badly understates the portfolio. Every value must be
// FX-converted to the display currency before summing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { aggregatePortfolio, convertMinor } from '../stockFormatters.ts';
import { midRate } from '../../../fx/utils/fxFormatters.ts';
import type { StockPosition } from '../../types/stocks.types.ts';

// ── Fixtures (mirror the UAT holdings: 2 NGN + 1 USD) ──────────────────────────
function pos(over: Partial<StockPosition>): StockPosition {
  return {
    assetId: 'x', symbol: 'X', name: 'X', exchange: 'NGX', iconColor: '#000',
    quantity: 1,
    averageCost: { amount: 0, currency: 'NGN' },
    marketValue: { amount: 0, currency: 'NGN' },
    costBasis: { amount: 0, currency: 'NGN' },
    unrealizedGainLoss: { amount: 0, currency: 'NGN' },
    unrealizedPct: 0,
    price: { amount: 0, currency: 'NGN' },
    change24hPct: 0,
    ...over,
  } as StockPosition;
}

const ngn1 = pos({ symbol: 'DANGCEM', marketValue: { amount: 5_826_000, currency: 'NGN' }, costBasis: { amount: 4_920_000, currency: 'NGN' }, change24hPct: 1.36 });
const ngn2 = pos({ symbol: 'GTCO', exchange: 'NGX', marketValue: { amount: 14_148_000, currency: 'NGN' }, costBasis: { amount: 10_680_000, currency: 'NGN' }, change24hPct: -0.94 });
const usd1 = pos({ symbol: 'AAPL', exchange: 'NASDAQ', marketValue: { amount: 411_120, currency: 'USD' }, costBasis: { amount: 342_360, currency: 'USD' }, change24hPct: 0.86 });

const positions = [ngn1, ngn2, usd1];
const RATE = midRate('USD', 'NGN'); // NGN per USD

// ── convertMinor ────────────────────────────────────────────────────────────────

test('convertMinor: same-currency is a passthrough', () => {
  assert.equal(convertMinor({ amount: 5_826_000, currency: 'NGN' }, 'NGN'), 5_826_000);
});

test('convertMinor: USD → NGN uses the FX mid-rate', () => {
  assert.equal(convertMinor({ amount: 411_120, currency: 'USD' }, 'NGN'), Math.round(411_120 * RATE));
});

// ── aggregatePortfolio — the reported bug ──────────────────────────────────────

test('BUG2: totalValue converts every position to the display currency before summing', () => {
  const t = aggregatePortfolio(positions, 'NGN');
  const expected = 5_826_000 + 14_148_000 + Math.round(411_120 * RATE);
  assert.equal(t.totalValue, expected);
});

test('BUG2: the naive mixed-currency sum (the old bug) is rejected', () => {
  const t = aggregatePortfolio(positions, 'NGN');
  const naive = 5_826_000 + 14_148_000 + 411_120; // kobo + cents, no FX
  assert.notEqual(t.totalValue, naive);
  assert.ok(t.totalValue > naive, 'a real USD holding must lift the NGN total far above the naive sum');
});

test('BUG2: cost basis, gain and day-change are all FX-converted too', () => {
  const t = aggregatePortfolio(positions, 'NGN');
  const expectedCost = 4_920_000 + 10_680_000 + Math.round(342_360 * RATE);
  const expectedValue = 5_826_000 + 14_148_000 + Math.round(411_120 * RATE);
  const expectedDay =
    Math.round((5_826_000 * 1.36) / 100) +
    Math.round((14_148_000 * -0.94) / 100) +
    Math.round((Math.round(411_120 * RATE) * 0.86) / 100);
  assert.equal(t.totalCostBasis, expectedCost, 'cost basis converted');
  assert.equal(t.totalGainLoss, expectedValue - expectedCost, 'gain = value − cost');
  assert.equal(t.dayChange, expectedDay, 'day change converted per position');
});

test('all-NGN portfolio equals the plain sum (no spurious conversion)', () => {
  const t = aggregatePortfolio([ngn1, ngn2], 'NGN');
  assert.equal(t.totalValue, 5_826_000 + 14_148_000);
});
