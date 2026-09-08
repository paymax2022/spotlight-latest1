/**
 * Where a browser is sent after Paystack redirects it back.
 *
 * The callback answered every redirect with `paymaxrn://…`, which a browser
 * cannot follow, so paying on web ended on a dead navigation (the charge was
 * recorded; the applicant just never got back). The fix carries the origin the
 * payment started from through Paystack — which makes it untrusted input on the
 * way back, so the guard below is the part that matters: this must never become
 * an open redirect.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isReturnableOrigin, buildWebReturnUrl } from '@/src/server/registration/return-origin';

const ORIGINAL = process.env.CORS_ALLOWED_ORIGINS;

describe('isReturnableOrigin', () => {
  beforeEach(() => { process.env.CORS_ALLOWED_ORIGINS = 'https://app.paymax.example,https://web.paymax.example'; });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = ORIGINAL;
  });

  it('allows any loopback port, which is how Expo web runs in dev', () => {
    for (const o of ['http://localhost:8083', 'http://127.0.0.1:8083', 'http://localhost:3000', 'https://localhost:8443']) {
      expect(isReturnableOrigin(o)).toBe(true);
    }
  });

  it('allows a configured deployed origin', () => {
    expect(isReturnableOrigin('https://app.paymax.example')).toBe(true);
    expect(isReturnableOrigin('https://web.paymax.example')).toBe(true);
  });

  it('REFUSES an origin that is merely similar to a configured one', () => {
    for (const o of [
      'https://app.paymax.example.evil.com',   // suffix attack
      'https://evil.com/app.paymax.example',   // path, not origin
      'https://app-paymax.example',            // lookalike
      'http://app.paymax.example',             // scheme downgrade
    ]) {
      expect(isReturnableOrigin(o)).toBe(false);
    }
  });

  it('REFUSES loopback lookalikes', () => {
    for (const o of ['http://localhost.evil.com', 'http://127.0.0.1.evil.com', 'https://notlocalhost']) {
      expect(isReturnableOrigin(o)).toBe(false);
    }
  });

  it('REFUSES anything carrying a path, query or fragment — that is not an origin', () => {
    for (const o of [
      'http://localhost:8083/evil',
      'http://localhost:8083?x=1',
      'http://localhost:8083#f',
      'http://localhost:8083/',
    ]) {
      expect(isReturnableOrigin(o)).toBe(false);
    }
  });

  it('REFUSES non-http schemes, including the one we fall back to', () => {
    for (const o of ['javascript:alert(1)', 'data:text/html,x', 'paymaxrn://registration/1', 'file:///etc/passwd']) {
      expect(isReturnableOrigin(o)).toBe(false);
    }
  });

  it('REFUSES empty and malformed values', () => {
    for (const o of ['', null, undefined, 'not a url', '//evil.com']) {
      expect(isReturnableOrigin(o as string)).toBe(false);
    }
  });
});

describe('buildWebReturnUrl', () => {
  it('targets the same screen the native deep link does', () => {
    const url = buildWebReturnUrl('http://localhost:8083', 'app-1', {
      status: 'SUCCESSFUL', reference: 'SPT-REG-1', transactionId: 'tx-1',
    });
    expect(url).toBe(
      'http://localhost:8083/registration/app-1/payment-processing?status=SUCCESSFUL&reference=SPT-REG-1&transactionId=tx-1',
    );
  });

  it('omits absent params rather than emitting empty ones', () => {
    const url = buildWebReturnUrl('http://localhost:8083', 'app-1', {
      status: 'FAILED', reference: undefined, transactionId: undefined,
    });
    expect(url).toBe('http://localhost:8083/registration/app-1/payment-processing?status=FAILED');
  });
});
