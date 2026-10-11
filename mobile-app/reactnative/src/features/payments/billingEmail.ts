// Which email Paystack can bill, and how to recognise the backend asking for one.
//
// Mirrors backend/internal/platform/billingemail (Go) and frontend-web's
// isBillableEmail so every plane agrees on what a usable address is. The rule on
// the server: the registered email if it passes, else the one supplied with the
// request, else 422 {"error":"email_required"} — and the app then asks the user.

export const EMAIL_REQUIRED_CODE = 'email_required';

const SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

// Addresses the platform generates for fixtures/placeholders; Paystack answers
// them with a generic 400.
const NON_ROUTABLE_TLDS = new Set(['internal', 'local', 'localhost', 'test', 'invalid', 'example']);

export function isBillableEmail(email: string | null | undefined): boolean {
  const e = (email ?? '').trim();
  if (!e || !SHAPE.test(e)) return false;
  const tld = e.slice(e.lastIndexOf('.') + 1).toLowerCase();
  return !NON_ROUTABLE_TLDS.has(tld);
}

/**
 * True when `err` is the backend's "a valid email is needed to pay" answer.
 * Accepts an axios error (`response.data.error`), a flattened `{status, data}`
 * and a bare `{code}` so it keeps working whichever way an API helper rethrows.
 */
export function isEmailRequiredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as {
    code?: unknown;
    status?: unknown;
    data?: { error?: unknown };
    response?: { status?: unknown; data?: { error?: unknown } };
  };
  if (e.code === EMAIL_REQUIRED_CODE) return true;
  const status = e.response?.status ?? e.status;
  const code = e.response?.data?.error ?? e.data?.error;
  return status === 422 && code === EMAIL_REQUIRED_CODE;
}
