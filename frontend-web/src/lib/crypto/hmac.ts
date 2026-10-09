import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time HMAC-SHA512 hex comparison for webhook signatures.
 * `expected !== signature` leaks prefix-match timing — an attacker can
 * recover a valid signature byte-by-byte. Both inputs are compared as raw
 * bytes of the hex digest; length mismatch short-circuits (digest length is
 * public knowledge, not secret).
 */
export function verifyHmacSha512Hex(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature ?? '', 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
