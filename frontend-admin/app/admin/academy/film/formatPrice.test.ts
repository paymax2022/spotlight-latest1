import { describe, it, expect } from 'vitest';
import { parseFormatPriceInput, MAX_FORMAT_PRICE_NGN } from './formatPrice';

describe('parseFormatPriceInput', () => {
  it('accepts whole naira above zero, trimming whitespace', () => {
    expect(parseFormatPriceInput('50000')).toBe(50000);
    expect(parseFormatPriceInput(' 1 ')).toBe(1);
    expect(parseFormatPriceInput('9999999999')).toBe(MAX_FORMAT_PRICE_NGN);
  });

  it('rejects blank instead of turning it into 0', () => {
    expect(parseFormatPriceInput('')).toBeNull();
    expect(parseFormatPriceInput('   ')).toBeNull();
    expect(parseFormatPriceInput(undefined)).toBeNull();
  });

  it('rejects zero, negatives, fractions, exponents and junk', () => {
    for (const bad of ['0', '000', '-5', '50000.5', '50000.00', '1e5', 'abc', '5,000', '+5']) {
      expect(parseFormatPriceInput(bad)).toBeNull();
    }
  });

  it('rejects values above 9,999,999,999', () => {
    expect(parseFormatPriceInput('10000000000')).toBeNull();
    expect(parseFormatPriceInput('99999999999999999999')).toBeNull();
  });
});
