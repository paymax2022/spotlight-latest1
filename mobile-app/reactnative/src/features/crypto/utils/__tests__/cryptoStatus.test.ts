// The app explains the server's operational controls before the customer fills in a form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatus, tradeAvailability, withdrawalBlock } from '../cryptoStatus.ts';

const open = parseStatus({ trading_paused: false, withdrawals_paused: false, disabled_assets: [], max_quote_kobo: 100, banner: null });
const btc = { symbol: 'BTC', status: 'active', buyEnabled: true, sellEnabled: true };

test('parseStatus keeps only well-formed fields', () => {
  const s = parseStatus({ trading_paused: true, disabled_assets: ['doge', 3], max_quote_kobo: 1.5, banner: { message: '  Back at 3pm  ', severity: 'warning' } });
  assert.equal(s.tradingPaused, true);
  assert.deepEqual(s.disabledAssets, ['DOGE']);
  assert.equal(s.maxQuoteKobo, 0);
  assert.deepEqual(s.banner, { message: 'Back at 3pm', severity: 'warning' });
  assert.equal(parseStatus({ banner: { message: 'x', severity: 'panic' } }).banner, null);
  assert.equal(parseStatus({ banner: { message: ' ', severity: 'info' } }).banner, null);
  assert.equal(parseStatus(null).tradingPaused, false);
});

test('an open market trades', () => {
  assert.deepEqual(tradeAvailability(open, btc), { canBuy: true, canSell: true, tradeReason: null });
  assert.equal(tradeAvailability(null, btc).canBuy, true, 'an older backend without the status route behaves as before');
});

test('every block explains itself, most important first', () => {
  const paused = { ...open, tradingPaused: true, disabledAssets: ['BTC'] };
  assert.match(tradeAvailability(paused, btc).tradeReason ?? '', /paused for maintenance/);
  assert.match(tradeAvailability({ ...open, disabledAssets: ['BTC'] }, btc).tradeReason ?? '', /Trading in BTC is paused/);
  assert.match(tradeAvailability('unknown', btc).tradeReason ?? '', /can't confirm/);
  assert.match(tradeAvailability(open, { ...btc, status: 'delisted' }).tradeReason ?? '', /delisted/);
  for (const st of [paused, 'unknown' as const]) {
    const a = tradeAvailability(st, btc);
    assert.equal(a.canBuy || a.canSell, false);
  }
});

test('a sell-only asset can still be sold', () => {
  const a = tradeAvailability(open, { ...btc, buyEnabled: false });
  assert.deepEqual([a.canBuy, a.canSell, a.tradeReason], [false, true, null]);
});

test('withdrawals: the kill switch and an unreadable status both block, with reasons', () => {
  assert.equal(withdrawalBlock(open), null);
  assert.equal(withdrawalBlock(null), null);
  assert.match(withdrawalBlock({ ...open, withdrawalsPaused: true }) ?? '', /paused/);
  assert.match(withdrawalBlock('unknown') ?? '', /can't confirm/);
});
