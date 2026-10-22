// Provider-rail portfolio: holdings come from the Quidax sub-account and are valued
// at the indicative price; cost basis is unknown and flagged, never faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitsToMinor, minorToUnits, portfolioFromBalances, quoteInputFor } from '../providerPortfolio.ts';

const usdt = {
  id: 'usdt', symbol: 'USDT', name: 'Tether', decimals: 6, iconColor: '#26A17B', riskRating: 'low',
  price: { amount: 150_000, currency: 'NGN' }, change24hPct: 0,
} as never;
const btc = {
  id: 'btc', symbol: 'BTC', name: 'Bitcoin', decimals: 8, iconColor: '#F7931A', riskRating: 'high',
  price: { amount: 10_000_000_000, currency: 'NGN' }, change24hPct: 10,
} as never;

test('units ↔ minor are exact and floor extra precision', () => {
  assert.equal(unitsToMinor('12.5', 6), 12_500_000);
  assert.equal(unitsToMinor('0.123456789', 6), 123_456, 'extra places are floored, never rounded up');
  assert.equal(unitsToMinor('nonsense', 6), 0);
  assert.equal(minorToUnits(12_500_000, 6), '12.5');
  assert.equal(minorToUnits(1, 8), '0.00000001');
  assert.equal(minorToUnits(100_000_000, 8), '1');
  assert.equal(minorToUnits(0, 8), '0');
});

test('balances become valued positions, largest first, cost basis flagged unknown', () => {
  const p = portfolioFromBalances(
    [
      { asset: 'USDT', available: '9', locked: '1', total: '10' },
      { asset: 'BTC', available: '0.01', locked: '0', total: '0.01' },
      { asset: 'DOGE', available: '5', locked: '0', total: '5' }, // not listed → skipped
    ],
    [usdt, btc],
    250_000,
  );
  assert.deepEqual(p.positions.map((x) => x.symbol), ['BTC', 'USDT']);
  const u = p.positions.find((x) => x.symbol === 'USDT')!;
  assert.equal(u.quantity.amount, 10_000_000);
  assert.equal(u.marketValue.amount, 1_500_000);
  assert.equal(u.availableUnits, '9', 'sell max is the AVAILABLE amount, not the total');
  assert.equal(u.costUnknown, true);
  assert.equal(p.totalValue.amount, 1_500_000 + 100_000_000);
  assert.equal(p.costUnknown, true);
  assert.equal(p.investableBalance.amount, 250_000);
});

test('no balances is an honest empty portfolio', () => {
  const p = portfolioFromBalances([], [usdt], 0);
  assert.equal(p.positions.length, 0);
  assert.equal(p.totalValue.amount, 0);
});

test('quoteInputFor: buys are priced in NGN, sells in crypto units', () => {
  const a = { symbol: 'USDT', decimals: 6, price: { amount: 150_000 } }; // ₦1,500 / USDT
  assert.deepEqual(quoteInputFor('buy', 'fiat', 1_000_000, a), { side: 'buy', asset: 'USDT', ngnKobo: 1_000_000 });
  assert.deepEqual(quoteInputFor('buy', 'crypto', 2_000_000, a), { side: 'buy', asset: 'USDT', ngnKobo: 300_000 });
  assert.deepEqual(quoteInputFor('sell', 'crypto', 2_500_000, a), { side: 'sell', asset: 'USDT', amount: '2.5' });
  assert.deepEqual(quoteInputFor('sell', 'fiat', 300_000, a), { side: 'sell', asset: 'USDT', amount: '2' });
  assert.equal(quoteInputFor('sell', 'crypto', 0, a), null);
  assert.equal(quoteInputFor('buy', 'fiat', Number.NaN, a), null);
  assert.equal(quoteInputFor('sell', 'fiat', 100, { ...a, price: { amount: 0 } }), null, 'no price, no conversion');
});
