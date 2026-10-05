/**
 * Security-header policy + unmatched-API-404 contract.
 *
 * The header policy lives in security-headers.config.mjs (imported by
 * next.config.mjs) precisely so it can be tested here — next.config.mjs
 * itself pulls in @sentry/nextjs/config. These specs pin the three behaviours
 * a production sweep found missing:
 *
 *   1. HSTS — absent entirely before; now 6 months, subdomains, NO preload
 *      (preload is a one-way browser-list submission, unsafe to enable blind).
 *   2. CSP stays Report-Only (enforcement waits on a violation-report review),
 *      but loopback origins are dev-only — they leaked into the prod policy.
 *   3. Unmatched /api/* used to fall through to the HTML 404 page; the
 *      app/api/[...notFound] catch-all + app/api/route.ts now answer JSON.
 */
import { describe, it, expect } from 'vitest';

import { buildReportOnlyCsp, buildSecurityHeaders } from '../../../security-headers.config.mjs';
import { GET as catchAllGET, POST as catchAllPOST } from '../../../app/api/[...notFound]/route';
import { GET as bareApiGET } from '../../../app/api/route';

function headerValue(headers: Array<{ key: string; value: string }>, key: string) {
  return headers.find((h) => h.key === key)?.value;
}

describe('security headers policy', () => {
  it('sends Strict-Transport-Security: 6 months, includeSubDomains, no preload', () => {
    const headers = buildSecurityHeaders({ dev: false });
    expect(headerValue(headers, 'Strict-Transport-Security')).toBe(
      'max-age=15552000; includeSubDomains',
    );
    expect(headerValue(headers, 'Strict-Transport-Security')).not.toContain('preload');
  });

  it('keeps the CSP report-only — the enforcing header name is never emitted', () => {
    const headers = buildSecurityHeaders({ dev: false });
    expect(headerValue(headers, 'Content-Security-Policy-Report-Only')).toBeTruthy();
    expect(headerValue(headers, 'Content-Security-Policy')).toBeUndefined();
  });

  it('keeps loopback origins out of the production connect-src', () => {
    const prod = buildReportOnlyCsp({ dev: false });
    expect(prod).not.toContain('localhost');
    expect(prod).not.toContain('127.0.0.1');
  });

  it('keeps loopback origins and unsafe-eval in dev', () => {
    const dev = buildReportOnlyCsp({ dev: true });
    expect(dev).toContain('http://localhost:*');
    expect(dev).toContain('ws://127.0.0.1:*');
    expect(dev).toContain("'unsafe-eval'");
  });

  it('drops unsafe-eval from the production script-src', () => {
    expect(buildReportOnlyCsp({ dev: false })).not.toContain("'unsafe-eval'");
  });
});

describe('unmatched /api/* → JSON 404', () => {
  it('returns a JSON 404 for a deep unmatched path', async () => {
    const res = await catchAllGET(new Request('https://app.test/api/nope/deep'), {
      params: Promise.resolve({ notFound: ['nope', 'deep'] }),
    });

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('GET /api/nope/deep');
  });

  it('returns a JSON 404 for non-GET methods too', async () => {
    const res = await catchAllPOST(new Request('https://app.test/api/nope', { method: 'POST' }), {
      params: Promise.resolve({ notFound: ['nope'] }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('POST /api/nope');
  });

  it('returns a JSON 404 for the bare /api path the catch-all cannot match', async () => {
    const res = await bareApiGET(new Request('https://app.test/api'));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('/api');
  });
});
