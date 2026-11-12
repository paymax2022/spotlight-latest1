import { describe, it, expect } from 'vitest';
import { describeUpstreamFailure } from './webProxyError';

const OPTS = { baseUrl: 'http://localhost:3000', timeoutMs: 20_000 };

/** undici wraps every socket failure as `TypeError: fetch failed` + a `cause`. */
function socket(code: string) {
  return Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error(`connect ${code} 127.0.0.1:3000`), { code }),
  });
}

describe('describeUpstreamFailure', () => {
  it('names a refused connection as a web app that is not listening', () => {
    const message = describeUpstreamFailure(socket('ECONNREFUSED'), OPTS);
    expect(message).toContain('ECONNREFUSED');
    expect(message).toContain('http://localhost:3000');
    expect(message).toContain('frontend-web');
  });

  it('names a mid-request reset as a restart or crash, not a refusal', () => {
    const message = describeUpstreamFailure(socket('ECONNRESET'), OPTS);
    expect(message).toContain('ECONNRESET');
    expect(message).toMatch(/closed the connection/i);
  });

  it('names a bad hostname as a WEB_API_BASE_URL mistake', () => {
    const message = describeUpstreamFailure(socket('ENOTFOUND'), OPTS);
    expect(message).toContain('ENOTFOUND');
    expect(message).toContain('WEB_API_BASE_URL');
  });

  it('quotes the deadline for an AbortSignal.timeout abort', () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const message = describeUpstreamFailure(timeout, OPTS);
    expect(message).toContain('20000ms');
    expect(message).toContain('WEB_PROXY_TIMEOUT_MS');
  });

  it('treats a bare AbortError as the same deadline', () => {
    const message = describeUpstreamFailure(
      new DOMException('This operation was aborted', 'AbortError'),
      OPTS,
    );
    expect(message).toContain('WEB_PROXY_TIMEOUT_MS');
  });

  it('finds the deadline when undici nests it under "fetch failed"', () => {
    const wrapped = Object.assign(new TypeError('fetch failed'), {
      cause: new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    });
    const message = describeUpstreamFailure(wrapped, OPTS);
    expect(message).toContain('WEB_PROXY_TIMEOUT_MS');
    expect(message).not.toContain('fetch failed');
  });

  it('reads the code off the error itself when there is no cause', () => {
    const message = describeUpstreamFailure(
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
      OPTS,
    );
    expect(message).toContain('ECONNRESET');
  });

  it('never invents a cause for an unknown failure', () => {
    const message = describeUpstreamFailure(new Error('boom'), OPTS);
    expect(message).toContain('boom');
    expect(message).not.toContain('ECONNREFUSED');
    expect(message).not.toContain('WEB_PROXY_TIMEOUT_MS');
  });

  it('survives a non-Error rejection', () => {
    expect(() => describeUpstreamFailure('kaboom', OPTS)).not.toThrow();
    expect(describeUpstreamFailure('kaboom', OPTS)).toContain('kaboom');
  });
});
