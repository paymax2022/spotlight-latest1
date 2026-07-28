import crypto from 'node:crypto';
import { creditWallet } from '@/src/server/wallet/service';
import { buildIdempotencyKey } from '@/src/server/wallet/ledger';
import { getVirtualAccountByNumber } from './service';

interface DvaWebhookResult {
  processed: boolean;
  duplicate: boolean;
  error?: string;
}

/**
 * Handle Paystack charge.success events for DVA (Dedicated Virtual Account) inbound transfers.
 * Identified by data.channel === 'dedicated_nuban'.
 *
 * Dedup strategy: ledger_entries.idempotency_key UNIQUE constraint.
 * If the CREDIT entry already exists for this reference, creditWallet returns alreadyProcessed=true.
 */
export async function handleDvaTransferWebhook(
  rawBody: string,
  signature: string,
): Promise<DvaWebhookResult> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) return { processed: false, duplicate: false, error: 'Paystack not configured' };

  const expected = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
  if (expected !== signature) {
    return { processed: false, duplicate: false, error: 'Invalid signature' };
  }

  const event = JSON.parse(rawBody) as {
    event: string;
    data: {
      reference: string;
      amount: number;
      channel?: string;
      currency?: string;
      authorization?: {
        account_number?: string;
      };
    };
  };

  // Only handle charge.success from DVA channel
  if (event.event !== 'charge.success') {
    return { processed: false, duplicate: false };
  }

  if (event.data?.channel !== 'dedicated_nuban') {
    return { processed: false, duplicate: false };
  }

  const reference = event.data?.reference;
  const amountKobo = event.data?.amount;
  const accountNumber = event.data?.authorization?.account_number;

  if (!reference || !amountKobo || !accountNumber) {
    return { processed: false, duplicate: false, error: 'Missing required DVA transfer fields' };
  }

  // Look up the virtual account to find the user
  const virtualAccount = await getVirtualAccountByNumber(accountNumber);
  if (!virtualAccount) {
    return { processed: false, duplicate: false };
  }

  try {
    const idempotencyKey = buildIdempotencyKey('dva', reference, 'CREDIT');

    const result = await creditWallet(virtualAccount.user_id, {
      amountKobo,
      reference: `DVA:${reference}`,
      idempotencyKey,
      description: `Inbound transfer to virtual account ${accountNumber}`,
      metadata: { payment_reference: reference, account_number: accountNumber },
    });

    return {
      processed: !result.alreadyProcessed,
      duplicate: result.alreadyProcessed,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { processed: false, duplicate: false, error: message };
  }
}
