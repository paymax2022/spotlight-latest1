/**
 * AUD-BE-014: the BFF→Go hop dropped the client IP entirely — no forwarding
 * header — so every proxied request arrived at the Go backend with the Next
 * server's address as ClientIP(). Per-IP controls (login/register/OTP limits,
 * signup gate) collapsed into one shared bucket, and audit rows plus the
 * suspicious-login engine recorded the BFF's address for all web traffic.
 *
 * These specs pin the fix: `clientIpHeaders()` produces the resolved client IP
 * as forwarding headers, and `proxyToGoBackend` sends them upstream. Go only
 * honours them when this host is inside TRUSTED_PROXY_CIDRS — sending them
 * unconditionally is safe either way (untrusted → fails closed to the peer IP,
 * which is the old behaviour).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clientIpHeaders } from '@/src/lib/rate-limit/client-ip';

function req(headers: Record<string, string>, path = 'https://app.test/api/x'): Request {
  return new Request(path, { method: 'GET', headers });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('clientIpHeaders', () => {
  it('resolves the edge-appended (real) client IP, dropping client-claimed hops', () => {
    const h = clientIpHeaders(req({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }));
    expect(h['x-forwarded-for']).toBe('5.6.7.8');
    expect(h['x-real-ip']).toBe('5.6.7.8');
  });

  it('collapses a chain shorter than the trusted hop count to the shared bucket IP', () => {
    vi.stubEnv('RATE_LIMIT_TRUSTED_PROXY_HOPS', '2');
    const h = clientIpHeaders(req({ 'x-forwarded-for': '1.2.3.4' }));
    expect(h['x-forwarded-for']).toBe('0.0.0.0');
  });
});

describe('proxyToGoBackend client-IP forwarding', () => {
  it('sends the resolved client IP upstream as x-forwarded-for/x-real-ip', async () => {
    const { proxyToGoBackend } = await import('@/src/lib/go-backend');
    const request = new Request('https://app.test/api/v1/x', {
      method: 'GET',
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    });
    await proxyToGoBackend(request, '/api/finance/x');

    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['x-forwarded-for']).toBe('5.6.7.8');
    expect(headers['x-real-ip']).toBe('5.6.7.8');
  });

  it('a forged single-hop XFF is forwarded verbatim (edge appended it = real peer)', async () => {
    const { proxyToGoBackend } = await import('@/src/lib/go-backend');
    const request = new Request('https://app.test/api/v1/x', {
      method: 'GET',
      headers: { 'x-forwarded-for': '198.51.100.23' },
    });
    await proxyToGoBackend(request, '/api/finance/x');

    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['x-forwarded-for']).toBe('198.51.100.23');
  });
});
