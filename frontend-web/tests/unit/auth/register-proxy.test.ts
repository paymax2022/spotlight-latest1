import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The register route is a PROXY to Go now. These pin the seam, because the last
// time web and Go each owned a registration they drifted until only one of them
// attributed referrals and only the other wrote an audit event.
const ORIGINAL_FETCH = globalThis.fetch;

async function callRoute(body: unknown) {
  const { POST } = await import('@/app/api/auth/register/route');
  return POST(new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

function mockUpstream(status: number, payload: unknown) {
  const spy = vi.fn(async () => new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json' },
  }));
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; vi.restoreAllMocks(); });

describe('POST /api/auth/register', () => {
  it('forwards to Go and passes the referral code through', async () => {
    const spy = mockUpstream(201, {
      success: true, needsVerification: true,
      user: { id: 'u-1', email: 'ada@example.test', fullName: 'Ada Obi' },
      tokens: { accessToken: '', refreshToken: '' },
    });

    const res = await callRoute({
      fullName: 'Ada Obi', email: 'Ada@Example.test', phone: '08031234567',
      password: 'Str0ngPass!23', referralCode: 'SPOT-XYZ',
    });

    expect(res.status).toBe(200);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/auth/register');
    const sent = JSON.parse(String(init.body));
    // Referral attribution only ever happened on the web path; it must survive
    // the move to Go, which means the code has to reach it.
    expect(sent.referralCode).toBe('SPOT-XYZ');
    expect(sent.email).toBe('ada@example.test');   // normalised
    expect(sent.fullName).toBe('Ada Obi');
  });

  it('reports needsVerification when Go returns no session', async () => {
    mockUpstream(201, { success: true, needsVerification: true, user: { id: 'u-1' }, tokens: {} });
    const res = await callRoute({ fullName: 'A B', email: 'a@b.test', password: 'Str0ngPass!23' });
    const body = await res.json();
    expect(body.needsVerification).toBe(true);
    expect(body.tokens.accessToken).toBe('');
  });

  it('defaults needsVerification to TRUE when Go omits it', async () => {
    // Fail closed: treating an unknown state as "verified" would let an
    // unconfirmed account straight into the app.
    mockUpstream(201, { success: true, user: { id: 'u-1' }, tokens: {} });
    const res = await callRoute({ fullName: 'A B', email: 'a@b.test', password: 'Str0ngPass!23' });
    expect((await res.json()).needsVerification).toBe(true);
  });

  it('passes a session through when confirmation is off', async () => {
    mockUpstream(201, {
      success: true, needsVerification: false,
      user: { id: 'u-2' }, tokens: { accessToken: 'at', refreshToken: 'rt' },
    });
    const body = await (await callRoute({ fullName: 'A B', email: 'a@b.test', password: 'Str0ngPass!23' })).json();
    expect(body.needsVerification).toBe(false);
    expect(body.tokens).toEqual({ accessToken: 'at', refreshToken: 'rt' });
  });

  it('rejects an incomplete body before calling upstream', async () => {
    const spy = mockUpstream(201, {});
    const res = await callRoute({ email: 'a@b.test' });
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not enrich the upstream error', async () => {
    // Go answers generically so a taken address is indistinguishable from a
    // rejected one. Adding detail here would rebuild the enumeration oracle.
    mockUpstream(400, { error: 'Registration failed. Please check your details and try again.' });
    const res = await callRoute({ fullName: 'A B', email: 'a@b.test', password: 'Str0ngPass!23' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).not.toMatch(/already|exists|registered/i);
  });

  it('answers 504 when Go is unreachable, not 500', async () => {
    globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const res = await callRoute({ fullName: 'A B', email: 'a@b.test', password: 'Str0ngPass!23' });
    expect(res.status).toBe(504);
  });
});
