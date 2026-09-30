import { GO_BACKEND_URL } from '@/src/lib/go-backend';

// AUD-INFRA-010: two Paystack webhook receivers exist — this Next.js route
// (designated live in docs) and the Go backend's POST /api/webhooks/paystack/go.
// Whichever URL the Paystack dashboard points at leaves the other plane's
// fulfilments dead. Go exclusively owns charge.success events whose reference
// carries one of these prefixes (EdTech fees, food orders, ride orders, estate
// dues); those are forwarded here so they fulfil regardless of dashboard config.
//
// Ambiguous events are deliberately NOT forwarded: transfer.*, DVA credits, and
// metadata.user_id wallet top-ups are claimed by BOTH planes under different
// idempotency keys — forwarding them risks double fulfilment. Consolidating
// that ownership is tracked separately under AUD-INFRA-010.
const GO_OWNED_REF_PREFIXES = ['feespay:', 'foodorder:', 'rideorder:', 'duespay:'];

export interface WebhookHandleResult {
  processed: boolean;
  duplicate: boolean;
  error?: string;
}

export async function forwardGoOwnedPaystackEvent(
  rawBody: string,
  signature: string,
): Promise<WebhookHandleResult> {
  let event: { event?: string; data?: { reference?: string } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { processed: false, duplicate: false };
  }

  const reference = event.data?.reference ?? '';
  const goOwned =
    event.event === 'charge.success' &&
    GO_OWNED_REF_PREFIXES.some((p) => reference.startsWith(p));
  if (!goOwned) {
    return { processed: false, duplicate: false };
  }

  // The Go handler re-verifies the signature on the raw body itself, so the
  // forward is byte-exact and carries the original X-Paystack-Signature.
  const res = await fetch(`${GO_BACKEND_URL}/api/webhooks/paystack/go`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-paystack-signature': signature,
    },
    body: rawBody,
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    throw new Error(`go webhook forward failed: ${res.status}`);
  }
  // The Go receiver returns 200 with {ok:false} on dispatch failure — for a
  // Go-owned reference that is a real fulfilment failure, so surface it as a
  // rejection and let the dispatcher's retry semantics apply.
  const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
  if (body && body.ok === false) {
    throw new Error('go webhook forward returned ok:false');
  }
  return { processed: true, duplicate: false };
}
