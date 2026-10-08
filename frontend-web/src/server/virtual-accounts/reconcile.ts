/**
 * DVA inbound self-heal (AUD-FE-004 residual).
 *
 * Inbound transfers to a Dedicated Virtual Account were webhook-only: a dropped
 * or failed `charge.success` meant Paystack had collected the sender's money
 * but the wallet was never credited, and no path existed to recover it.
 *
 * This mirrors the wallet top-up "verify-on-read" pattern: reading the account
 * (GET /api/v1/virtual-accounts/me) reconciles the customer's recent
 * successful Paystack transactions on the `dedicated_nuban` channel against
 * the ledger, crediting any the webhook missed. Both paths post through the
 * SAME `dva:<reference>:CREDIT` idempotency key, so a reconcile and a late
 * webhook racing the same transfer credit it exactly once.
 *
 * Everything here fails OPEN for the read it decorates: an unreachable
 * Paystack, an error reply, or a shape we do not recognise yields zero credits
 * and no error — a payment we cannot confirm is left alone, never marked.
 */

import { creditWallet } from '@/src/server/wallet/service';
import { buildIdempotencyKey } from '@/src/server/wallet/ledger';
import type { VirtualAccountRow } from './service';

interface PaystackTransactionListItem {
  reference?: string;
  amount?: number;
  status?: string;
  channel?: string;
  currency?: string;
  authorization?: { account_number?: string };
}

export interface DvaReconcileResult {
  /** How many recent transactions Paystack returned for the customer. */
  checked: number;
  /** How many were newly credited to the wallet on this pass. */
  credited: number;
}

/**
 * The one place an inbound DVA transfer is credited — shared by the webhook
 * handler and the read-time reconcile. The key shape MUST stay
 * `dva:<paystack-reference>:CREDIT`: it is the only thing preventing the two
 * paths from crediting the same transfer twice.
 */
export async function creditDvaInboundTransfer(args: {
  userId: string;
  reference: string;
  amountKobo: number;
  accountNumber: string;
}): Promise<{ alreadyProcessed: boolean }> {
  const result = await creditWallet(args.userId, {
    amountKobo: args.amountKobo,
    reference: `DVA:${args.reference}`,
    idempotencyKey: buildIdempotencyKey('dva', args.reference, 'CREDIT'),
    description: `Inbound transfer to virtual account ${args.accountNumber}`,
    metadata: { payment_reference: args.reference, account_number: args.accountNumber },
  });
  return { alreadyProcessed: result.alreadyProcessed };
}

function isInboundToThisAccount(
  tx: PaystackTransactionListItem,
  accountNumber: string,
): tx is PaystackTransactionListItem & { reference: string; amount: number } {
  if (tx?.channel !== 'dedicated_nuban') return false;
  if (tx?.authorization?.account_number !== accountNumber) return false;
  if (tx?.status !== 'success') return false;
  if (typeof tx.reference !== 'string' || tx.reference.length === 0) return false;
  // Kobo must be an integer — a fractional/unparseable amount is refused rather
  // than rounded into a credit.
  return Number.isInteger(tx.amount) && (tx.amount as number) > 0;
}

/**
 * Re-credit recent inbound DVA transfers the webhook may have dropped.
 * Bounded to the newest page (25) of the customer's successful transactions —
 * a sweep, not a full history replay — and best-effort: a single failing
 * credit does not drop the rest of the page.
 */
export async function reconcileDvaInboundTransfers(
  account: VirtualAccountRow,
): Promise<DvaReconcileResult> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey || !account.customer_code) {
    return { checked: 0, credited: 0 };
  }

  let payload: { status?: boolean; data?: PaystackTransactionListItem[] | null };
  try {
    const url =
      `https://api.paystack.co/transaction?status=success&perPage=25` +
      `&customer=${encodeURIComponent(account.customer_code)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${secretKey}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    payload = await res.json();
  } catch {
    return { checked: 0, credited: 0 };
  }

  if (!payload || payload.status !== true || !Array.isArray(payload.data)) {
    return { checked: 0, credited: 0 };
  }

  const checked = payload.data.length;
  let credited = 0;

  for (const tx of payload.data) {
    if (!isInboundToThisAccount(tx, account.account_number)) continue;
    try {
      const { alreadyProcessed } = await creditDvaInboundTransfer({
        userId: account.user_id,
        reference: tx.reference,
        amountKobo: tx.amount,
        accountNumber: account.account_number,
      });
      if (!alreadyProcessed) credited += 1;
    } catch (err) {
      // One bad credit must not drop the rest of the page; the transfer stays
      // uncredited until the next read or webhook replay — never marked done.
      console.error(
        `[virtual-accounts] DVA reconcile credit failed for ${tx.reference}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { checked, credited };
}
