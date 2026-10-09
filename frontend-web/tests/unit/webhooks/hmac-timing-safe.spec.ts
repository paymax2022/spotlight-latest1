/**
 * Webhook HMAC verification must be constant-time.
 *
 * Every frontend Paystack webhook handler previously compared the computed
 * digest with `expected !== signature` — a prefix-timing oracle. This spec
 * pins the shared helper's contract: exact match → true; any mismatch,
 * truncation, or length difference → false; never throws on malformed input.
 */
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyHmacSha512Hex } from '@/src/lib/crypto/hmac';

const SECRET = 'test-secret';
const BODY = JSON.stringify({ event: 'charge.success', data: { reference: 'ref_1' } });

function sign(body: string, secret: string = SECRET): string {
  return createHmac('sha512', secret).update(body).digest('hex');
}

describe('verifyHmacSha512Hex', () => {
  it('accepts the correct signature', () => {
    expect(verifyHmacSha512Hex(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it('rejects a signature over a different body', () => {
    expect(verifyHmacSha512Hex(BODY + ' ', sign(BODY), SECRET)).toBe(false);
  });

  it('rejects a signature under a different secret', () => {
    expect(verifyHmacSha512Hex(BODY, sign(BODY, 'other-secret'), SECRET)).toBe(false);
  });

  it('rejects a truncated (prefix-matching) signature', () => {
    const good = sign(BODY);
    expect(verifyHmacSha512Hex(BODY, good.slice(0, good.length - 1), SECRET)).toBe(false);
  });

  it('rejects empty and non-hex input without throwing', () => {
    expect(verifyHmacSha512Hex(BODY, '', SECRET)).toBe(false);
    expect(verifyHmacSha512Hex(BODY, 'not-hex!!!', SECRET)).toBe(false);
  });
});
