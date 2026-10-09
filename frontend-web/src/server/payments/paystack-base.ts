/**
 * Base URL for Paystack server-side API calls.
 *
 * Defaults to the real API. PAYSTACK_BASE_URL exists so local e2e and CI can
 * point the SAME code path at the deterministic rail in tools/fakes
 * (/transaction/initialize, /transaction/verify/:ref, /paystack/simulate)
 * instead of mocking fetch — the request shapes, signature scheme and settle
 * semantics are identical to the provider's.
 *
 * Server-side only: never NEXT_PUBLIC, never shipped to the client.
 */
export function paystackApiBase(): string {
  const base = process.env.PAYSTACK_BASE_URL?.trim();
  return base && base.length > 0 ? base.replace(/\/+$/, '') : 'https://api.paystack.co';
}
