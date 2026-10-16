// Pure-logic tests: `npm run test:academy-live`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConnection, jwtExpiresAt, isTokenUsable, describeConnectionFailure } from '../connection.ts';

// header.payload.signature, payload = {"exp": 2000000000}
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: Record<string, unknown>) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.c2lnbmF0dXJl`;
const GOOD = jwt({ exp: 2_000_000_000 });

test('a LiveKit join response becomes a connection', () => {
  const r = parseConnection({ token: GOOD, rtc: { provider: 'livekit', url: 'wss://rtc.example.com' } });
  assert.deepEqual(r, { ok: true, connection: { url: 'wss://rtc.example.com', token: GOOD } });
});

test('https is normalised to wss and a trailing slash is dropped', () => {
  const r = parseConnection({ token: GOOD, rtc: { provider: 'livekit', url: 'https://rtc.example.com/' } });
  assert.ok(r.ok && r.connection.url === 'wss://rtc.example.com');
});

test('no rtc block means this class is not on LiveKit: never try to connect', () => {
  assert.deepEqual(parseConnection({ token: GOOD }), { ok: false, reason: 'no_rtc' });
  assert.deepEqual(parseConnection({ token: GOOD, rtc: null }), { ok: false, reason: 'no_rtc' });
});

test('another provider is refused', () => {
  assert.deepEqual(parseConnection({ token: GOOD, rtc: { provider: 'videosdk', url: 'wss://x.example.com' } }), { ok: false, reason: 'wrong_provider' });
});

test('the dev stub token is not a token', () => {
  const r = parseConnection({ token: 'stub-token-room-u-host', rtc: { provider: 'livekit', url: 'wss://rtc.example.com' } });
  assert.deepEqual(r, { ok: false, reason: 'no_token' });
  for (const bad of ['', undefined, null, 42, 'a.b', 'a.b.c.d', ' ']) {
    assert.equal(parseConnection({ token: bad as never, rtc: { provider: 'livekit', url: 'wss://rtc.example.com' } }).ok, false, String(bad));
  }
});

test('plaintext ws:// and http:// are refused unless explicitly allowed (dev builds)', () => {
  const raw = { token: GOOD, rtc: { provider: 'livekit', url: 'ws://192.168.1.5:7880' } };
  assert.deepEqual(parseConnection(raw), { ok: false, reason: 'insecure_url' });
  const dev = parseConnection(raw, { allowInsecure: true });
  assert.ok(dev.ok && dev.connection.url === 'ws://192.168.1.5:7880');
  assert.deepEqual(parseConnection({ ...raw, rtc: { provider: 'livekit', url: 'http://x.example.com' } }), { ok: false, reason: 'insecure_url' });
});

test('malformed or hostile URLs are refused', () => {
  for (const url of ['', 'not a url', 'ftp://x.example.com', 'wss://', 'wss://user:pw@rtc.example.com', 'javascript:alert(1)', 42, undefined]) {
    const r = parseConnection({ token: GOOD, rtc: { provider: 'livekit', url: url as never } });
    assert.equal(r.ok, false, String(url));
  }
});

test('jwtExpiresAt reads exp in milliseconds, and nothing for garbage', () => {
  assert.equal(jwtExpiresAt(GOOD), 2_000_000_000 * 1000);
  assert.equal(jwtExpiresAt(jwt({ sub: 'x' })), null);
  assert.equal(jwtExpiresAt('a.b.c'), null);
  assert.equal(jwtExpiresAt(jwt({ exp: 'soon' })), null);
});

test('isTokenUsable refuses an expired token or one about to expire', () => {
  const now = 1_700_000_000_000;
  assert.equal(isTokenUsable(jwt({ exp: now / 1000 + 600 }), now), true);
  assert.equal(isTokenUsable(jwt({ exp: now / 1000 - 1 }), now), false);
  assert.equal(isTokenUsable(jwt({ exp: now / 1000 + 5 }), now, 10_000), false, 'inside the skew window');
  // A token we cannot read an expiry from is allowed: the server is the authority.
  assert.equal(isTokenUsable(jwt({ sub: 'x' }), now), true);
});

test('every failure has a plain-language message that never mentions internals', () => {
  for (const r of ['no_rtc', 'wrong_provider', 'no_token', 'bad_url', 'insecure_url'] as const) {
    const m = describeConnectionFailure(r);
    assert.ok(m.length > 10, r);
    assert.doesNotMatch(m, /livekit|token|jwt|wss?:/i, r);
  }
  assert.match(describeConnectionFailure('no_rtc'), /not available/i);
});

test('jwtExpiresAt copes with padding, float and string exp values', () => {
  const padded = `${b64({ alg: 'HS256' })}.${b64({ exp: 2_000_000_000 })}=.c2ln`;
  assert.equal(jwtExpiresAt(padded), 2_000_000_000 * 1000);
  assert.equal(jwtExpiresAt(jwt({ exp: 2_000_000_000.5 })), 2_000_000_000.5 * 1000);
  assert.equal(jwtExpiresAt(jwt({ exp: '2000000000' })), null);
});

test('ports must be real and IPv6 literals are handled', () => {
  const mk = (url: string) => parseConnection({ token: GOOD, rtc: { provider: 'livekit', url } });
  assert.equal(mk('wss://rtc.example.com:99999').ok, false);
  assert.equal(mk('wss://rtc.example.com:0').ok, false);
  assert.equal(mk('wss://rtc.example.com:7881').ok, true);
  assert.equal(mk('wss://[2001:db8::1]:443').ok, true);
  assert.equal(mk('wss://rtc.example.com:abc').ok, false);
});
