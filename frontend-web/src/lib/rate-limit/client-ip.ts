// Accepts Request (not NextRequest) so plain-Web-API callers (utility _utils.ts
// takes Request) can share it — NextRequest extends Request, so both work.

// Client-IP derivation for rate-limit keys.
// The old pattern — `x-forwarded-for` split(',')[0] — trusts the LEFTMOST XFF
// entry, which is the one a client can claim arbitrarily: `curl -H
// "X-Forwarded-For: 1.2.3.4"` mints a fresh bucket key per request, defeating
// every IP-keyed limit (and, for free votes, the daily IP-scoped allowance and
// duplicate_ip fraud scoring).
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

  // direct client can forge it identically, so this is best-effort, not
  // authoritative — same exposure as before, now through one shared path.
  return sanitized(request.headers.get('x-real-ip')) ?? '0.0.0.0';
}

/**
 * Headers that propagate the resolved client IP to an upstream service.
 *
 * The BFF→Go fetches previously sent no forwarding headers at all, so every
 * proxied request arrived at the Go backend with the Next server's address as
 * ClientIP() — collapsing per-IP controls (login/register/OTP rate limits,
 * signup gate) into one shared bucket and recording the BFF's IP in audit
 * rows and the suspicious-login engine's IP signals (AUD-BE-014).
 *
 * Go only honours these when the BFF's egress IP is inside its
 * TRUSTED_PROXY_CIDRS; without that it fails closed to the direct peer
 * address, which is today's behaviour — the header is safe to send always.
 */
export function clientIpHeaders(request: Request): Record<string, string> {
  const ip = getRequestIp(request);
  return { 'x-forwarded-for': ip, 'x-real-ip': ip };
}
