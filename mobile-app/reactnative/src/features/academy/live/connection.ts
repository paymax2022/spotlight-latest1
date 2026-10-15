// Turns the backend's join response into something the LiveKit client may dial, or a reason it
// must not. Pure (no SDK import) so it can be unit-tested with `npm run test:academy-live`.
//
// Rules, all fail-closed:
//  - the response must carry an `rtc` block saying provider "livekit" (the dev stub and VideoSDK
//    responses do not, and must never be dialled);
//  - the token must look like a JWT (the dev stub's "stub-token-..." is not one);
//  - the URL must be wss:// (https:// is normalised to it). Plaintext ws:// / http:// is refused
//    unless the caller opts in, which only development builds should do.

export type Connection = { url: string; token: string };

export type ConnectionFailure = 'no_rtc' | 'wrong_provider' | 'no_token' | 'bad_url' | 'insecure_url';

export type ConnectionResult = { ok: true; connection: Connection } | { ok: false; reason: ConnectionFailure };

export interface JoinResponseLike {
  token?: unknown;
  rtc?: { provider?: unknown; url?: unknown } | null;
}

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
// scheme://host[:port][/path] only: no userinfo, query, fragment or whitespace. The host is a DNS
// name or a bracketed IPv6 literal; the port, when present, is checked below.
const URL_RE = /^(wss|ws|https|http):\/\/(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::(\d{1,5}))?(\/[^\s?#@]*)?$/i;

export function parseConnection(raw: JoinResponseLike, opts: { allowInsecure?: boolean } = {}): ConnectionResult {
  const rtc = raw?.rtc;
  if (!rtc || typeof rtc !== 'object') return { ok: false, reason: 'no_rtc' };
  if (rtc.provider !== 'livekit') return { ok: false, reason: 'wrong_provider' };
  if (typeof raw.token !== 'string' || !JWT_RE.test(raw.token)) return { ok: false, reason: 'no_token' };
  if (typeof rtc.url !== 'string') return { ok: false, reason: 'bad_url' };

  const m = URL_RE.exec(rtc.url.trim());
  if (!m) return { ok: false, reason: 'bad_url' };
  const scheme = m[1].toLowerCase();
  const secure = scheme === 'wss' || scheme === 'https';
  if (!secure && !opts.allowInsecure) return { ok: false, reason: 'insecure_url' };
  const port = m[3];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return { ok: false, reason: 'bad_url' };
  const path = (m[4] ?? '').replace(/\/+$/, '');
  return { ok: true, connection: { url: `${secure ? 'wss' : 'ws'}://${m[2]}${port ? `:${port}` : ''}${path}`, token: raw.token } };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Base64url to bytes without relying on atob (not guaranteed on every JS engine). */
function b64urlToBytes(s: string): Uint8Array | null {
  const clean = s.replace(/=+$/, '');
  const out: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** The token's `exp` in milliseconds, or null when it cannot be read. Not a signature check. */
export function jwtExpiresAt(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const bytes = b64urlToBytes(parts[1]);
  if (!bytes) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as { exp?: unknown };
    return typeof claims.exp === 'number' && Number.isFinite(claims.exp) ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * False when the token has expired, or will within `skewMs`: dialling it would only fail. A token
 * whose expiry cannot be read is allowed; the server is the authority.
 */
export function isTokenUsable(token: string, nowMs: number, skewMs = 0): boolean {
  const exp = jwtExpiresAt(token);
  return exp === null ? true : exp - skewMs > nowMs;
}

/** What to tell the learner when the join response cannot be dialled. */
export function describeConnectionFailure(reason: ConnectionFailure): string {
  switch (reason) {
    case 'no_rtc':
    case 'wrong_provider':
      return 'Live video is not available for this class yet.';
    case 'insecure_url':
      return 'This class is not reachable over a secure connection, so it was not opened.';
    case 'no_token':
    case 'bad_url':
    default:
      return 'This class could not be opened. Please try again in a moment.';
  }
}
