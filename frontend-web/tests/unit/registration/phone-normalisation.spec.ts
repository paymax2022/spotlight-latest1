import { describe, it, expect } from 'vitest';
import {
  isValidNigerianPhone,
  normaliseNigerianPhone,
} from '@/src/features/registration/validation';

describe('normaliseNigerianPhone', () => {
  it('canonicalises local, spaced and international spellings to E.164', () => {
    for (const input of [
      '08012345678',
      '0801 234 5678',
      '0801-234-5678',
      '(0801) 234.5678',
      '8012345678',
      '2348012345678',
      '+2348012345678',
      '+234 801 234 5678',
      '  +234 (801) 234-5678  ',
    ]) {
      expect(normaliseNigerianPhone(input), input).toBe('+2348012345678');
    }
  });

  it('accepts every live mobile prefix family', () => {
    for (const number of ['07031234567', '08101234567', '09091234567', '09151234567']) {
      expect(normaliseNigerianPhone(number), number).not.toBe('');
    }
  });

  it('rejects values that are not Nigerian mobile numbers', () => {
    for (const input of ['', '   ', 'abc', '12345', '0601234567', '+447700900123', '+2346012345678']) {
      expect(normaliseNigerianPhone(input), input).toBe('');
    }
  });

  it('exposes a boolean guard that matches the normaliser', () => {
    expect(isValidNigerianPhone('0801 234 5678')).toBe(true);
    expect(isValidNigerianPhone('not-a-number')).toBe(false);
  });
});
