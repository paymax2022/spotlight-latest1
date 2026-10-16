import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENCY_CODE, NAIRA_SYMBOL, ITEM_PRICE_BOUNDS, PACKAGING_BOUNDS,
  sanitizeNairaInput, parseNaira, formatNaira,
} from '../money.ts';

test('the currency is NGN and the symbol is the naira sign', () => {
  assert.equal(CURRENCY_CODE, 'NGN');
  assert.equal(NAIRA_SYMBOL, '₦');
});

// ── typing: only characters that can be money survive ────────────────────────
test('sanitize keeps digits and one decimal point, at most 2 decimals', () => {
  assert.equal(sanitizeNairaInput('2500'), '2500');
  assert.equal(sanitizeNairaInput('2500.5'), '2500.5');
  assert.equal(sanitizeNairaInput('2500.567'), '2500.56');
  assert.equal(sanitizeNairaInput('12.3.4'), '12.34');
});

test('sanitize drops the symbol, commas, spaces, letters, signs and exponents', () => {
  assert.equal(sanitizeNairaInput('₦ 1,500'), '1500');
  assert.equal(sanitizeNairaInput('-200'), '200');
  assert.equal(sanitizeNairaInput('1e3'), '13');
  assert.equal(sanitizeNairaInput('abc'), '');
  assert.equal(sanitizeNairaInput('NGN 20'), '20');
});

test('sanitize trims leading zeros but keeps a lone zero and "0."', () => {
  assert.equal(sanitizeNairaInput('007'), '7');
  assert.equal(sanitizeNairaInput('0'), '0');
  assert.equal(sanitizeNairaInput('0.5'), '0.5');
  assert.equal(sanitizeNairaInput('.5'), '0.5');
  assert.equal(sanitizeNairaInput('.'), '0.');
});

// ── parsing: text -> integer kobo, never through a float ─────────────────────
test('parse turns naira text into exact integer kobo', () => {
  assert.deepEqual(parseNaira('2500', ITEM_PRICE_BOUNDS), { ok: true, kobo: 250000 });
  assert.deepEqual(parseNaira('350.5', ITEM_PRICE_BOUNDS), { ok: true, kobo: 35050 });
  assert.deepEqual(parseNaira('0.10', ITEM_PRICE_BOUNDS), { ok: true, kobo: 10 });
  assert.deepEqual(parseNaira('8.29', ITEM_PRICE_BOUNDS), { ok: true, kobo: 829 }); // 8.29*100 is 828.999.. in floats
  assert.deepEqual(parseNaira('₦1,500', ITEM_PRICE_BOUNDS), { ok: true, kobo: 150000 });
});

test('parse accepts what is on screen mid-typing: "200." and ".5"', () => {
  assert.deepEqual(parseNaira('200.', ITEM_PRICE_BOUNDS), { ok: true, kobo: 20000 });
  assert.deepEqual(parseNaira('.5', ITEM_PRICE_BOUNDS), { ok: true, kobo: 50 });
  assert.equal(parseNaira('.', ITEM_PRICE_BOUNDS).ok, false);
});

test('parse refuses blank, non-numeric, negative and 3+ decimal input', () => {
  for (const bad of ['', '   ', 'abc', '-5', '1e3', '1.234', '12..3', '--1']) {
    const r = parseNaira(bad, ITEM_PRICE_BOUNDS);
    assert.equal(r.ok, false, `expected "${bad}" to be refused`);
    if (!r.ok) assert.ok(r.error.length > 0);
  }
});

test('an item price must be above zero, a packaging price may be zero', () => {
  assert.equal(parseNaira('0', ITEM_PRICE_BOUNDS).ok, false);
  assert.equal(parseNaira('0.00', ITEM_PRICE_BOUNDS).ok, false);
  assert.deepEqual(parseNaira('0', PACKAGING_BOUNDS), { ok: true, kobo: 0 });
});

test('the ceiling mirrors the server: N1,000,000 an item, N10,000 a pack', () => {
  assert.deepEqual(parseNaira('1000000', ITEM_PRICE_BOUNDS), { ok: true, kobo: 100_000_000 });
  assert.equal(parseNaira('1000000.01', ITEM_PRICE_BOUNDS).ok, false);
  assert.deepEqual(parseNaira('10000', PACKAGING_BOUNDS), { ok: true, kobo: 1_000_000 });
  assert.equal(parseNaira('10000.01', PACKAGING_BOUNDS).ok, false);
});

test('the over-limit message names the limit with the naira symbol', () => {
  const r = parseNaira('2000000', ITEM_PRICE_BOUNDS);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /₦1,000,000/);
});

test('absurdly long numbers are refused, not rounded into a safe-looking value', () => {
  assert.equal(parseNaira('9'.repeat(40), ITEM_PRICE_BOUNDS).ok, false);
});

// ── display ──────────────────────────────────────────────────────────────────
test('format shows the naira sign, grouping, and kobo only when there is some', () => {
  assert.equal(formatNaira(250000), '₦2,500');
  assert.equal(formatNaira(250050), '₦2,500.50');
  assert.equal(formatNaira(5), '₦0.05');
  assert.equal(formatNaira(0), '₦0');
  assert.equal(formatNaira(100_000_000), '₦1,000,000');
});

test('format never prints NaN or a float artefact for bad input', () => {
  assert.equal(formatNaira(Number.NaN), '₦0');
  assert.equal(formatNaira(-100), '-₦1');
  assert.equal(formatNaira(829), '₦8.29');
});
