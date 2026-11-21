// Turning a server-issued path into a URL a phone can open, without a second
// dependency and without an `expo` import.
//
// The Open Mic API stores and serves *root-relative* paths on purpose
// (`/api/open-mic/beats/…`, `/api/open-mic/songs/…`): the value that lands in
// the database must not bake in a host, because that is exactly how the
// localhost banner was once shipped to production. Whoever reads the value adds
// its own origin — which for a phone means the *device-resolved* origin, since
// `localhost` on a handset is the handset.
//
// This module is pure (no expo, no react-native) so `node --test` can pin the
// rules; `media.ts` supplies the origin they need.

const ABSOLUTE_RE = /^[a-z][a-z0-9+.-]*:/i;
const ORIGIN_RE = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)/i;

/** Is this already a full URL? */
export function isAbsoluteUrl(value: unknown): boolean {
  const text = String(value ?? '').trim();
  return !!text && ABSOLUTE_RE.test(text);
}

/** `https://host:3000/deep/path?x=1` → `https://host:3000`. */
export function originOf(value: unknown): string {
  const text = String(value ?? '').trim();
  const match = ORIGIN_RE.exec(text);
  if (match) return match[1];
  // A bare `host:port` with no scheme is a config typo, not a URL: hand it back
  // with https so a mis-set env var fails loudly over http rather than silently.
  const bare = text.replace(/\/+$/, '');
  return bare ? `https://${bare}` : '';
}

/**
 * Absolute in, absolute out. Root-relative (and bare-relative) paths get the
 * origin glued on; an empty value stays empty so a caller can render "nothing to
 * play" instead of a broken player.
 *
 * A relative path with no origin is handed back unchanged rather than dropped:
 * the web build resolves it against its own document, and a caller that already
 * knows the origin passes one.
 */
export function absolutise(origin: unknown, value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (isAbsoluteUrl(text)) return text;
  const base = String(origin ?? '').trim().replace(/\/+$/, '');
  if (!base) return text;
  return text.startsWith('/') ? `${base}${text}` : `${base}/${text}`;
}

/**
 * Only http(s) may be handed to an audio player, a `Linking.openURL` or a
 * download. A `javascript:` or `file:` value in a stored column must never reach
 * a native player, so this is an allowlist, not a denylist — the same posture
 * `publicBeatUrl` keeps on the server.
 */
export function isPlayableHttpUrl(value: unknown): boolean {
  return /^https?:\/\//i.test(String(value ?? '').trim());
}

/**
 * The beat reader's one switch: `?download=1` makes it answer with an attachment
 * instead of `inline` bytes.
 *
 * Both directions live here because they are pure string rules over a URL this
 * app already built, and `node --test` can pin them; the caller that knows the
 * device origin (`media.ts`) just glues the origin on first.
 */
export function withDownloadFlag(value: string): string {
  if (!value) return value;
  if (/[?&]download=1(&|$)/.test(value)) return value;
  return `${value}${value.includes('?') ? '&' : '?'}download=1`;
}

/**
 * The same address with the attachment flag removed, for a player.
 *
 * Written against `URLSearchParams` rather than a regex so a flag in the middle
 * of a query (`?a=1&download=1&b=2`) cannot leave a dangling separator behind.
 * An address that does not parse is returned untouched: it is not ours to edit.
 */
export function withoutDownloadFlag(value: string): string {
  if (!value) return value;
  if (!/[?&]download=1(&|$)/.test(value)) return value;
  try {
    const parsed = new URL(value);
    parsed.searchParams.delete('download');
    return parsed.toString();
  } catch {
    return value;
  }
}
