/**
 * Recognising the KYC gate on an API error.
 *
 * Money endpoints (wallet balance, top-up, …) answer 403 when the caller's KYC tier is
 * too low — "This feature requires KYC Tier N. Your current tier is M." — and also 403
 * "KYC verification check failed. Access denied." when the server's own tier lookup
 * errors (it fails closed). Both mean the same thing to a user: verify your identity.
 * A bare 403 with any other text (feature off, forbidden, …) is not this and must not
 * send people to identity verification.
 *
 * The shared axios client rewrites `error.message` to the server's own message, so that
 * is read first; the response body is the fallback for errors that bypassed it.
 */

const MAX_TIER = 3; // tiers are 0..3; anything above is not trusted

/** The KYC tier the server demanded, or `null` when this error is not the KYC gate. */
export function kycTierRequired(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as {
    response?: { status?: number; data?: { error?: unknown; message?: unknown } };
    message?: unknown;
  };
  if (e.response?.status !== 403) return null;

  const candidates = [e.message, e.response?.data?.error, e.response?.data?.message];
  const text = candidates.find((c): c is string => typeof c === 'string' && /kyc/i.test(c));
  if (!text) return null;

  const m = /tier\s*(\d+)/i.exec(text);
  const tier = m ? Number(m[1]) : 1;
  return tier >= 1 && tier <= MAX_TIER ? tier : 1;
}
