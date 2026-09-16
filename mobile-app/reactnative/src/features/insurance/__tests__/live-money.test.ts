// Price presentation for the live MyCover catalog.
//   node --experimental-strip-types --test src/features/insurance/__tests__/live-money.test.ts
// Pure module, no `@/` imports in the chain — loads under plain Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cadenceLabel,
  coverPeriodLabel,
  indicativePremiumKobo,
  nairaCompact,
  nairaFromKobo,
  nairaInputToKobo,
  percentFromBps,
  priceDisplay,
} from '../live/money.ts';

test('naira formatting keeps kobo only when they exist', () => {
  assert.equal(nairaFromKobo(600000), '₦6,000');
  assert.equal(nairaFromKobo(600050), '₦6,000.50');
  assert.equal(nairaFromKobo(0), '₦0');
  // Garbage must render as zero rather than "₦NaN" leaking onto a price tag.
  assert.equal(nairaFromKobo(Number.NaN), '₦0');
});

test('compact naira scales without inventing precision', () => {
  assert.equal(nairaCompact(1_150_000_000), '₦11.5M');
  assert.equal(nairaCompact(200_000_000), '₦2M');
  assert.equal(nairaCompact(5_000_000), '₦50k');
  assert.equal(nairaCompact(90_000), '₦900');
});

test('basis points read as the percentages MyCover actually publishes', () => {
  assert.equal(percentFromBps(50), '0.5%');   // 0.5  — sti-git-annual
  assert.equal(percentFromBps(90), '0.9%');   // 0.9  — goxi-cred-plus
  assert.equal(percentFromBps(100), '1%');    // 1
  assert.equal(percentFromBps(250), '2.5%');  // 2.5  — goxi-default-creditlife
  assert.equal(percentFromBps(25), '0.25%');
});

test('a PERCENTAGE product never renders as a naira amount', () => {
  // The whole point: base_price 0.5 means "0.5% of what you insure", and
  // printing "₦0.50" would misprice it by orders of magnitude to the reader.
  const rate = priceDisplay({
    name: 'Annual Goods In Transit',
    basePriceKobo: 50,
    isPercentage: true,
    rateBps: 50,
    coverPeriodDays: 365,
  });
  assert.equal(rate.kind, 'percentage');
  assert.equal(rate.headline, '0.5%');
  assert.equal(rate.prefix, 'from');
  assert.equal(rate.suffix, 'of value insured');
  assert.ok(!rate.headline.includes('₦'));
});

test('a FLAT product renders an exact amount with no "from"', () => {
  const flat = priceDisplay({
    name: 'Traveller Accident Basic',
    basePriceKobo: 50_000,
    isPercentage: false,
    rateBps: 0,
    coverPeriodDays: 365,
  });
  assert.equal(flat.kind, 'flat');
  assert.equal(flat.headline, '₦500');
  assert.equal(flat.prefix, '');
  assert.equal(flat.suffix, '/yr');
});

test('cover periods map to the real MyCover values', () => {
  assert.equal(cadenceLabel(365), '/yr');
  assert.equal(cadenceLabel(180), '/6mo');
  assert.equal(cadenceLabel(30), '/mo');
  assert.equal(cadenceLabel(7), '/wk');
  assert.equal(cadenceLabel(2), '/2d');
  assert.equal(coverPeriodLabel(365), '1 year cover');
  assert.equal(coverPeriodLabel(1), '1 day cover');
});

test('indicative premium is integer kobo arithmetic only', () => {
  // ₦2,000,000 at 0.5% = ₦10,000
  assert.equal(indicativePremiumKobo(200_000_000, 50), 1_000_000);
  // No float drift, and never a fractional kobo.
  const p = indicativePremiumKobo(123_456_789, 90);
  assert.ok(Number.isInteger(p));
  // Nonsense inputs yield 0, never NaN.
  assert.equal(indicativePremiumKobo(-1, 50), 0);
  assert.equal(indicativePremiumKobo(100, 0), 0);
});

test('typed naira converts to kobo without float error', () => {
  assert.equal(nairaInputToKobo('1,500.50'), 150050);
  assert.equal(nairaInputToKobo('0.1'), 10);
  assert.equal(nairaInputToKobo('50000'), 5_000_000);
  assert.equal(nairaInputToKobo(''), 0);
});
