import { verifyPin } from '@/features/transfers/api';
import { describePinFailure } from '@/features/payments/pinFailure';

/**
 * The step-up gate for the crypto money actions (buy, sell, swap, withdraw).
 *
 * The crypto endpoints take no PIN in the request body, so a screen that only
 * checked that four digits were typed would let any PIN move money. This runs the
 * same central verification the wallet checkout and bill pay use
 * (POST /transfers/pin/verify) and returns the member-facing reason for the
 * failure, or null when the PIN is good. A wrong answer is scored against the
 * account lockout here, exactly as it is at a payment.
 *
 * Binding the verified PIN to the debit itself is server work, tracked in #500;
 * until then this is the check that gates the action.
 */
export async function authorizePin(pin: string): Promise<string | null> {
  try {
    await verifyPin(pin);
    return null;
  } catch (err) {
    return describePinFailure(err).message;
  }
}
