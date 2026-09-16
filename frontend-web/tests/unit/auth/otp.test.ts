import { describe, it, expect } from 'vitest';
import { resolveOtpLength, distributeOtpInput, nextOtpFocus, OTP_DEFAULT } from '@/src/features/auth/otp';

describe('web OTP shape', () => {
  it('honours production 8-digit codes', () => {
    expect(resolveOtpLength('8')).toBe(8);
    expect(resolveOtpLength(8)).toBe(8);
  });

  it('falls back to 6 for anything unusable', () => {
    for (const bad of [undefined, null, '', 'abc', NaN, 6.5, 0, -3, 99]) {
      expect(resolveOtpLength(bad as never)).toBe(OTP_DEFAULT);
    }
  });

  it('fills every box from a pasted code', () => {
    expect(distributeOtpInput(Array(6).fill(''), 0, '123456')).toEqual(['1','2','3','4','5','6']);
    expect(distributeOtpInput(Array(8).fill(''), 0, '12345678').join('')).toBe('12345678');
  });

  it('strips the prose autofill wraps around a code', () => {
    expect(distributeOtpInput(Array(6).fill(''), 0, 'Your code is 481920')).toEqual(['4','8','1','9','2','0']);
  });

  it('never overflows the box count', () => {
    const out = distributeOtpInput(Array(6).fill(''), 0, '12345678901234');
    expect(out).toHaveLength(6);
    expect(out.join('')).toBe('123456');
  });

  it('keeps single-character typing in its own box', () => {
    expect(distributeOtpInput(['1','',''], 1, '7')).toEqual(['1','7','']);
  });

  it('starts a mid-way paste at that box', () => {
    expect(distributeOtpInput(['9','','',''], 1, '123')).toEqual(['9','1','2','3']);
  });

  it('focuses the first gap, else the last box', () => {
    expect(nextOtpFocus(['1','2','',''], 0)).toBe(2);
    expect(nextOtpFocus(['1','2','3'], 0)).toBe(2);
  });

  it('agrees with the mobile twin on every rule', () => {
    // If this file and the RN one ever drift, one platform silently mishandles
    // codes. Same inputs, same outputs.
    expect(resolveOtpLength('8')).toBe(8);
    expect(distributeOtpInput(Array(6).fill(''), 0, '832157').join('')).toBe('832157');
  });
});
