// Pure-logic unit tests for insurance price presentation.
//   node --experimental-strip-types --test src/features/insurance/__tests__/money.test.ts
//
// WHY THIS FILE EXISTS
// MyCover returns every amount as a NAIRA DECIMAL STRING ("6000.0000", "0.5"),
// while Paymax's iron rule is integers in kobo. `base_price` is ALSO polymorphic:
// a flat premium when `is_percentage` is false, and a RATE IN PERCENT when it is
// true. Rendering a percentage product as a flat naira price misprices it by
// orders of magnitude to the reader's eye — "₦0.50" for a cover that actually
// costs 0.5% of a ₦10,000,000 consignment.
//
// Facts encoded below are from the live-probed provider map
// (docs/prd/Insurance/MYCOVER-API-MAP.md §3, "The money contract"), not invented.
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

// ── nairaFromKobo ───────────────────────────────────────────────────────────

test('nairaFromKobo renders whole naira without decimals and part-naira with them', () => {
  assert.equal(nairaFromKobo(600_000), '₦6,000');
  assert.equal(nairaFromKobo(150_050), '₦1,500.50');
  assert.equal(nairaFromKobo(100), '₦1');
  assert.equal(nairaFromKobo(99), '₦0.99');
  assert.equal(nairaFromKobo(0), '₦0');
});

test('nairaFromKobo can be forced to 2dp for alignment in a summary table', () => {
  assert.equal(nairaFromKobo(600_000, { decimals: true }), '₦6,000.00');
});

test('nairaFromKobo never emits NaN into the UI', () => {
  // A sparse/garbage provider row must degrade to ₦0, not "₦NaN".
  assert.equal(nairaFromKobo(NaN), '₦0');
  assert.equal(nairaFromKobo(Infinity), '₦0');
  // @ts-expect-error — runtime robustness: JS callers can pass anything.
  assert.equal(nairaFromKobo(undefined), '₦0');
});

test('nairaFromKobo truncates sub-kobo rather than carrying a float', () => {
  // The iron rule is integers in kobo; a fractional kobo is a bug upstream and
  // must not round UP into money that was never charged.
  assert.equal(nairaFromKobo(150_050.9), '₦1,500.50');
});

// ── nairaCompact ────────────────────────────────────────────────────────────

test('nairaCompact abbreviates at k/M/B for stat tiles', () => {
  assert.equal(nairaCompact(1_150_000_000), '₦11.5M');
  assert.equal(nairaCompact(100_000_000), '₦1M');
  assert.equal(nairaCompact(500_000_000_000), '₦5B');
});

test('nairaCompact leaves values under ₦10,000 fully written out', () => {
  // ₦9,999 must not become "₦10.0k" — a sum insured that small is meaningful.
  assert.equal(nairaCompact(999_900), '₦9,999');
});

// ── percentFromBps — the PERCENTAGE half of the money contract ──────────────

test('percentFromBps renders the real MyCover rates exactly', () => {
  // 0.5% arrives from the provider as base_price "0.5" with is_percentage true,
  // and is stored as 50 basis points. Round-tripping it back to "0.5%" is the
  // whole point of rateBps existing.
  assert.equal(percentFromBps(50), '0.5%');
  assert.equal(percentFromBps(250), '2.5%');
  assert.equal(percentFromBps(100), '1%');
  assert.equal(percentFromBps(150), '1.5%');
});

test('percentFromBps keeps sub-tenth rates legible', () => {
  assert.equal(percentFromBps(10), '0.1%');
  assert.equal(percentFromBps(5), '0.05%');
  assert.equal(percentFromBps(1), '0.01%');
  assert.equal(percentFromBps(105), '1.05%');
});

test('percentFromBps drops the trailing zero but never a significant digit', () => {
  // "0.50%" reads as a different precision claim than "0.5%".
  assert.equal(percentFromBps(50), '0.5%');
  // ...but 0.05% must keep its leading zero or it becomes 0.5%, a 10x error.
  assert.equal(percentFromBps(5), '0.05%');
});

test('percentFromBps degrades a garbage rate to 0% rather than NaN%', () => {
  assert.equal(percentFromBps(0), '0%');
  assert.equal(percentFromBps(NaN), '0%');
});

// ── cadence / cover period ──────────────────────────────────────────────────

test('cadenceLabel maps the real MyCover cover_period values', () => {
  // Live catalog uses 1, 2, 7, 12, 30, 180 and 365.
  assert.equal(cadenceLabel(365), '/yr');
  assert.equal(cadenceLabel(180), '/6mo');
  assert.equal(cadenceLabel(30), '/mo');
  assert.equal(cadenceLabel(7), '/wk');
  assert.equal(cadenceLabel(2), '/2d');
  assert.equal(cadenceLabel(1), '/1d');
});

test('cadenceLabel emits nothing when the cover period is unknown', () => {
  // An empty suffix is correct here: "₦6,000" with no cadence beats inventing one.
  assert.equal(cadenceLabel(0), '');
});

test('coverPeriodLabel agrees in number with the count it prints', () => {
  // REGRESSION: the plural threshold used to test raw DAYS (`d >= 56`) while the
  // number shown is Math.round(d / 30), so every cover of 45–55 days rendered
  // "2 month cover" — a plural count against a singular noun.
  assert.equal(coverPeriodLabel(45), '2 months cover');
  assert.equal(coverPeriodLabel(55), '2 months cover');
  assert.equal(coverPeriodLabel(30), '1 month cover');
  assert.equal(coverPeriodLabel(60), '2 months cover');
});

test('coverPeriodLabel names the long periods in their own words', () => {
  assert.equal(coverPeriodLabel(365), '1 year cover');
  assert.equal(coverPeriodLabel(180), '6 months cover');
  assert.equal(coverPeriodLabel(12), '12 days cover');
  assert.equal(coverPeriodLabel(1), '1 day cover');
});

test('coverPeriodLabel says the period varies rather than claiming 0 days', () => {
  assert.equal(coverPeriodLabel(0), 'Cover period varies');
});

// ── priceDisplay — the one place FLAT and PERCENTAGE diverge ────────────────

const FLAT = {
  name: 'FlexiCare Retail',
  basePriceKobo: 600_000, // ₦6,000
  isPercentage: false,
  rateBps: 0,
  coverPeriodDays: 365,
};

const PERCENTAGE = {
  name: 'Marine Cover',
  basePriceKobo: 50, // meaningless for a percentage product
  isPercentage: true,
  rateBps: 50, // 0.5%
  coverPeriodDays: 365,
};

test('priceDisplay renders a flat product as an exact naira price', () => {
  const d = priceDisplay(FLAT);
  assert.equal(d.kind, 'flat');
  assert.equal(d.headline, '₦6,000');
  assert.equal(d.suffix, '/yr');
  // No "from" — the flat premium IS the price, and hedging it reads as evasive.
  assert.equal(d.prefix, '');
});

test('priceDisplay renders a percentage product as a RATE, never as naira', () => {
  const d = priceDisplay(PERCENTAGE);
  assert.equal(d.kind, 'percentage');
  assert.equal(d.headline, '0.5%');
  assert.equal(d.suffix, 'of value insured');
  assert.equal(d.prefix, 'from');
  // The bug this guards: basePriceKobo is 50 for this product. Rendering it as
  // a flat price yields "₦0.50" for cover that really costs 0.5% of the value.
  assert.ok(!d.headline.includes('₦'), 'a percentage product must not show a ₦ headline');
});

test('priceDisplay a11y text is speakable for both kinds', () => {
  assert.equal(priceDisplay(FLAT).a11y, 'FlexiCare Retail, ₦6,000 per yr');
  assert.equal(
    priceDisplay(PERCENTAGE).a11y,
    'Marine Cover, from 0.5% of the value you insure',
  );
});

test('priceDisplay a11y does not trail whitespace when there is no cadence', () => {
  const d = priceDisplay({ ...FLAT, coverPeriodDays: 0 });
  assert.equal(d.a11y, 'FlexiCare Retail, ₦6,000');
});

// ── indicativePremiumKobo — integer math only ──────────────────────────────

test('indicativePremiumKobo computes a percentage premium in integer kobo', () => {
  // 0.5% of ₦1,000,000 = ₦5,000.
  assert.equal(indicativePremiumKobo(100_000_000, 50), 500_000);
  // 2.5% of ₦250,000 = ₦6,250.
  assert.equal(indicativePremiumKobo(25_000_000, 250), 625_000);
});

test('indicativePremiumKobo returns an integer for every input', () => {
  // A fractional kobo would violate the iron rule the moment it were summed.
  for (const [sum, bps] of [
    [33_333_333, 50],
    [1, 1],
    [7_777_777, 137],
  ]) {
    const out = indicativePremiumKobo(sum, bps);
    assert.ok(Number.isInteger(out), `${sum}@${bps}bps produced non-integer ${out}`);
  }
});

test('indicativePremiumKobo refuses nonsense instead of returning a negative price', () => {
  assert.equal(indicativePremiumKobo(0, 50), 0);
  assert.equal(indicativePremiumKobo(100_000, 0), 0);
  assert.equal(indicativePremiumKobo(-100_000, 50), 0);
  assert.equal(indicativePremiumKobo(NaN, 50), 0);
});

// ── nairaInputToKobo — the user-typed side of the boundary ─────────────────

test('nairaInputToKobo parses a formatted naira string to integer kobo', () => {
  assert.equal(nairaInputToKobo('1,500.50'), 150_050);
  assert.equal(nairaInputToKobo('1500'), 150_000);
  assert.equal(nairaInputToKobo('₦2,000'), 200_000);
});

test('nairaInputToKobo treats a single decimal place as tenths of naira', () => {
  // "1500.5" is ₦1,500.50 — NOT ₦1,500.05.
  assert.equal(nairaInputToKobo('1500.5'), 150_050);
});

test('nairaInputToKobo truncates beyond kobo rather than rounding up', () => {
  // Rounding up would charge a kobo nobody typed.
  assert.equal(nairaInputToKobo('1500.567'), 150_056);
});

test('nairaInputToKobo reads a bare decimal as naira', () => {
  assert.equal(nairaInputToKobo('.5'), 50);
});

test('nairaInputToKobo yields 0 for anything unparseable', () => {
  assert.equal(nairaInputToKobo(''), 0);
  assert.equal(nairaInputToKobo('abc'), 0);
  // @ts-expect-error — runtime robustness.
  assert.equal(nairaInputToKobo(null), 0);
  // @ts-expect-error — runtime robustness.
  assert.equal(nairaInputToKobo(undefined), 0);
});

test('nairaInputToKobo round-trips through nairaFromKobo', () => {
  for (const typed of ['1,500.50', '6,000', '0.99', '250,000']) {
    const kobo = nairaInputToKobo(typed);
    const rendered = nairaFromKobo(kobo);
    assert.equal(
      nairaInputToKobo(rendered),
      kobo,
      `"${typed}" -> ${kobo} -> "${rendered}" did not round-trip`,
    );
  }
});
