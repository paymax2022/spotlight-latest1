import { findTopupIntent, settleTopupIntent, type SettlementResult } from './settle';

/**
 * Verify-on-read settlement.
 *
 * Paystack delivers webhooks on a best-effort basis: they can be delayed,
 * dropped, or — on a developer's machine, where api.paystack.co cannot reach
 * localhost — never delivered at all. The customer has paid either way, and
 * until the credit lands the checkout waiting on it just spins.
 *
 * So when a top-up is still pending, ask Paystack directly. Its verify endpoint
 * is the authority; the webhook is only a notification that it is worth asking.
 *
 * Everything here fails CLOSED: only an explicit `success` from Paystack, for
 * exactly the amount the intent expects, credits anything. An unreachable API,
 * an error reply, or a shape we do not recognise leaves the intent pending — a
 * payment we cannot confirm must never be treated as one that failed, because
 * marking it failed would strand money that is really there.
 */

const PAYSTACK_VERIFY_URL = 'https://api.paystack.co/transaction/verify';

export interface VerifyResult extends SettlementResult {
  /** Whether Paystack could be reached and gave a usable answer. */
  checked: boolean;
}

export async function verifyAndSettleTopup(
  reference: string,
  userId: string,
): Promise<VerifyResult> {
  const intent = await findTopupIntent(reference);
  if (!intent) return { settled: false, alreadySettled: false, checked: false };

  // Ownership is enforced here rather than left to the caller: this function
  // moves money, and the reference is user-supplied.
  if (intent.user_id !== userId) {
    return { settled: false, alreadySettled: false, checked: false };
  }

  // Nothing to ask Paystack about — the wallet already holds it.
  if (intent.status === 'completed') {
    return { settled: true, alreadySettled: true, checked: false };
  }

  // A 'failed' intent IS re-verified, deliberately.
  //
  // That status is set by any exception during settlement — a database blip
  // included — as well as by a genuine amount mismatch. Money that exists at the
  // PSP must always keep a path to the customer, and a terminal state set by a
  // possibly-transient error strands it forever.
  //
  // Re-verifying is safe because nothing is taken on trust the second time: the
  // amount is re-checked against the intent (a real mismatch simply fails again,
  // moving nothing), and the credit is idempotent, so an intent that failed
  // AFTER its journal posted resolves to completed instead of staying wrong.

  // Deliberately AFTER the state checks above: whether this intent is already
  // settled is a fact about our own database, and must not depend on whether a
  // payment provider happens to be configured.
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) return { settled: false, alreadySettled: false, checked: false };

  let payload: { status?: boolean; data?: { status?: string; amount?: number } | null };
  try {
    const res = await fetch(`${PAYSTACK_VERIFY_URL}/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
      cache: 'no-store',
    });
    payload = await res.json();
  } catch {
    // Network failure tells us nothing about the payment. Leave it pending.
    return { settled: false, alreadySettled: false, checked: false };
  }

  if (!payload || payload.status !== true || !payload.data) {
    return { settled: false, alreadySettled: false, checked: false };
  }

  const { status, amount } = payload.data;

  // 'ongoing', 'pending', 'abandoned', 'failed', 'reversed' — none of these are
  // money we hold. Only 'success' is.
  if (status !== 'success') {
    return { settled: false, alreadySettled: false, checked: true };
  }

  const result = await settleTopupIntent(intent, Number(amount), reference);
  return { ...result, checked: true };
}
