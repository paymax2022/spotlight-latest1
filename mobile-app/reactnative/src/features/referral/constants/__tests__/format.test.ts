// node --experimental-strip-types --test "src/features/referral/constants/__tests__/*.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatNaira } from '../format.ts';

test('a commission with kobo keeps its remainder (680 kobo is ₦6.80, not ₦6)', () => {
  assert.equal(formatNaira(680), '₦6.80');
});

test('whole-naira amounts still render without decimals', () => {
  assert.equal(formatNaira(600), '₦6');
  assert.equal(formatNaira(150_000), '₦1,500');
  assert.equal(formatNaira(0), '₦0');
});

test('sub-naira remainders keep the leading zeros', () => {
  assert.equal(formatNaira(5), '₦0.05');
  assert.equal(formatNaira(123_456), '₦1,234.56');
});

test('missing amounts are an em dash', () => {
  assert.equal(formatNaira(null), '—');
  assert.equal(formatNaira(undefined), '—');
});
