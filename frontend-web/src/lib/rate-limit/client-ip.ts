// Accepts Request (not NextRequest) so plain-Web-API callers (utility _utils.ts
// takes Request) can share it — NextRequest extends Request, so both work.

// Client-IP derivation for rate-limit keys.
//
// The old pattern — `x-forwarded-for` split(',')[0] — trusts the LEFTMOST XFF
// entry, which is the one a client can claim arbitrarily: `curl -H
// "X-Forwarded-For: 1.2.3.4"` mints a fresh bucket key per request, defeating
// every IP-keyed limit (and, for free votes, the daily IP-scoped allowance and
// duplicate_ip fraud scoring).
//
// XFF is appended to by proxies, not prepended: the client-controllable part is
// at the FRONT. In a chain of N trusted proxies the real client IP sits at
// index len-N — everything after it was appended by proxies we control.
// RATE_LIMIT_TRUSTED_PROXY_HOPS sets N (default 1: the platform edge proxy that
// terminates TLS). If the header carries fewer entries than N, the chain is
// shorter than we trust — nothing in it is reliable, so we fall back to the
// shared bucket.

const IP_RE = /^[0-9a-fA-F:.%]{1,45}$/;

function trustedProxyHops(): number {
  const raw = Number.parseInt(process.env.RATE_LIMIT_TRUSTED_PROXY_HOPS ?? '1', 10);
  if (!Number.isFinite(raw) || raw < 0) return 1;
  return Math.min(raw, 10);
}

function sanitized(value: string | undefined | null): string | null {
  const v = value?.trim();
  return v && IP_RE.test(v) ? v : null;
}

export function getRequestIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  const hops = trustedProxyHops();

  if (xff && hops > 0) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    const idx = parts.length - hops;
    if (idx >= 0) {
      const candidate = sanitized(parts[idx]);
      if (candidate) return candidate;
    }
    // Chain shorter than the trusted hop count — attacker-tampered or direct
    // request with a forged header. Group it instead of trusting it.
    return '0.0.0.0';
  }

  // No XFF: x-real-ip is only meaningful when the edge proxy sets it; a
  // direct client can forge it identically, so this is best-effort, not
  // authoritative — same exposure as before, now through one shared path.
  return sanitized(request.headers.get('x-real-ip')) ?? '0.0.0.0';
}
