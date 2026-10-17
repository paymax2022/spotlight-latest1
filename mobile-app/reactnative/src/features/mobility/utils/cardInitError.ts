export const CARD_UNAVAILABLE_MESSAGE =
  'Card payment is unavailable right now. Please try again shortly or pay from your wallet.';

/**
 * Turns a failed Paystack-ride initialize into something the rider can read.
 * The server answers a bare `internal` for any upstream failure (e.g. Paystack
 * refusing our key), and the API client surfaces that word as the error message.
 * `email_required` is returned untouched: the checkout hook keys its email
 * prompt off the original error. Specific client errors keep their own text.
 */
export function cardInitFailure(err: unknown): unknown {
  const e = err as { message?: unknown; code?: unknown; response?: { status?: unknown; data?: { error?: unknown } } } | undefined;
  // Mirrors payments/billingEmail isEmailRequiredError, inlined so this file stays
  // importable by the node test runner (which needs explicit .ts import paths).
  if (e?.code === 'email_required' || (e?.response?.status === 422 && e.response.data?.error === 'email_required')) return err;
  const status = typeof e?.response?.status === 'number' ? e.response.status : 0;
  const message = typeof e?.message === 'string' ? e.message.trim() : '';
  if (!message || message.toLowerCase() === 'internal' || status >= 500) {
    return new Error(CARD_UNAVAILABLE_MESSAGE);
  }
  return err instanceof Error ? err : new Error(message);
}
