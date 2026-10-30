// Customer-facing text for a failed server-side gateway initialization.
//
// When a card rail is switched off the customer does not get a reason they can
// act on: the Go router answers 404 with its own routing text
// ("No API route matches POST /api/finance/restaurant/<id>/orders/paystack/
// initiate") and the frontend-web BFF answers 503. That leaks an internal API
// path onto a checkout screen mid-payment. Everything else the server returns IS
// customer-written (KYC tier gate, insufficient balance, price changed), so only
// these two shapes are replaced; the rest passes through untouched.

export const RAIL_UNAVAILABLE =
  'Card and bank-transfer payment is not available for this order right now. ' +
  'Please pay another way, or try again in a little while.';

const GENERIC_FAILURE = 'Could not start payment. Please try again.';

// Matches the Go/BFF 404 envelope and a bare "GET /api/…" style string, so a
// route leak is caught even when the caller lost the status code.
const ROUTE_LEAK = /no api route matches|^\s*(?:get|post|put|patch|delete|head)\s+\/api\//i;

export function customerFacingInitError(e: unknown): string {
  const status = (e as { response?: { status?: number } } | null | undefined)?.response?.status;
  const raw = e instanceof Error ? e.message.trim() : '';
  if (status === 404 || status === 503 || ROUTE_LEAK.test(raw)) return RAIL_UNAVAILABLE;
  return raw || GENERIC_FAILURE;
}
