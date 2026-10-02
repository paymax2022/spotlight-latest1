'use client';

/**
 * Client half of the server-side registration-fee payment-intent flow
 * (AUD-FE-003 residual).
 *
 * The flow is:
 *   1. POST /api/registration/applications/{id}/payment/initiate — the SERVER
 *      quotes the fee from the draft, mints the SPT-REG-* reference, binds it
 *      to a registration_payment_intents row, and initializes the Paystack
 *      transaction itself. A client-minted reference would orphan the charge
 *      from the webhook/recover/reconcile fulfilment paths.
 *   2. The popup RESUMES that server-created transaction by access code
 *      (PaystackPop.resumeTransaction) — passing the reference to
 *      newTransaction is a "Duplicate charge request for reference" error.
 *   3. GET .../payment/verify confirms the charge against Paystack before the
 *      application is submitted — the client never self-declares 'paid'.
 *
 * Retries send a FRESH Idempotency-Key each call: the route re-issues the
 * single per-(application, method) intent row in place, so a retried attempt
 * can never double-charge.
 */
import { authFetch } from '@/src/lib/auth/flow';
import { loadPaystackClient } from '@/src/lib/payments';

export type RegistrationPaymentStart =
  /** An intent for this application already settled — skip checkout entirely. */
  | { kind: 'paid'; reference: string }
  /** Server initialized a Paystack transaction — resume it in the popup. */
  | {
      kind: 'checkout';
      reference: string;
      transactionId?: string;
      accessCode?: string;
      authorizationUrl?: string;
    }
  | { kind: 'unauthorized' }
  | { kind: 'error'; message: string; status?: number };

export type RegistrationPaymentConfirmation =
  | 'SUCCESSFUL'
  | 'FAILED'
  | 'PENDING'
  | 'unauthorized'
  | 'error';

export async function startRegistrationPayment(
  applicationId: string,
  email: string,
): Promise<RegistrationPaymentStart> {
  let res: Response;
  try {
    res = await authFetch(
      `/api/registration/applications/${applicationId}/payment/initiate`,
      {
        method: 'POST',
        // Fresh key per ATTEMPT — crypto.randomUUID, never Math.random (the
        // same key replayed would hand back the previous intent instead of
        // issuing a usable checkout for this attempt).
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ method: 'PAYSTACK', email }),
      },
      { json: true },
    );
  } catch {
    return { kind: 'error', message: 'Could not reach the payment service. Check your connection and try again.' };
  }

  if (res.status === 401) return { kind: 'unauthorized' };

  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || payload?.success !== true) {
    return {
      kind: 'error',
      message: String(payload?.error || 'Could not start the registration fee payment.'),
      status: res.status,
    };
  }

  const reference = String(payload.reference || '');
  if (payload.status === 'completed') {
    return { kind: 'paid', reference };
  }

  if (!reference) {
    return { kind: 'error', message: 'Could not start the registration fee payment.' };
  }

  return {
    kind: 'checkout',
    reference,
    transactionId: payload.transactionId ? String(payload.transactionId) : undefined,
    accessCode: payload.accessCode ? String(payload.accessCode) : undefined,
    authorizationUrl: payload.authorizationUrl ? String(payload.authorizationUrl) : undefined,
  };
}

/**
 * Present the server-initialized Paystack transaction to the user.
 * Resolves with the charge reference on popup success; rejects on cancel or
 * error. When the response carries no access code, falls back to the hosted
 * checkout redirect (the payment/callback route still records the charge
 * server-side on the way back).
 */
export async function resumeRegistrationCheckout(start: {
  reference: string;
  accessCode?: string;
  authorizationUrl?: string;
}): Promise<{ reference: string }> {
  if (!start.accessCode) {
    if (!start.authorizationUrl) {
      throw new Error('Payment checkout could not be opened. Please try again.');
    }
    // Full-page redirect — this never resolves; the browser leaves the page.
    window.location.assign(start.authorizationUrl);
    return new Promise<{ reference: string }>(() => {});
  }

  const Paystack = await loadPaystackClient();
  const popup = new Paystack();
  return new Promise<{ reference: string }>((resolve, reject) => {
    popup.resumeTransaction(start.accessCode as string, {
      onSuccess: (tx) => resolve({ reference: tx?.reference || start.reference }),
      onCancel: () => reject(new Error('Payment was cancelled.')),
      onError: (error) => reject(new Error(error?.message || 'Payment failed.')),
    });
  });
}

/**
 * Bounded poll of the server verify endpoint. SUCCESSFUL means the intent is
 * settled and the draft already records payment.transactionReference +
 * payment.paymentStatus server-side (applyRegistrationPaymentSuccess) — the
 * caller should proceed to submit. PENDING means Paystack had not settled
 * within the polling window; submit still re-checks the intent server-side,
 * so the caller may proceed and surface the draft's resulting status.
 */
export async function confirmRegistrationPayment(
  applicationId: string,
  reference: string,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<RegistrationPaymentConfirmation> {
  const attempts = Math.max(1, options.attempts ?? 4);
  const delayMs = options.delayMs ?? 1500;

  for (let i = 0; i < attempts; i++) {
    let res: Response;
    try {
      res = await authFetch(
        `/api/registration/applications/${applicationId}/payment/verify?reference=${encodeURIComponent(reference)}`,
        { cache: 'no-store' },
      );
    } catch {
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      return 'error';
    }

    if (res.status === 401) return 'unauthorized';

    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return 'error';

    const status = String(payload?.status || '').toUpperCase();
    if (status === 'SUCCESSFUL' || status === 'FAILED') return status;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }

  return 'PENDING';
}
