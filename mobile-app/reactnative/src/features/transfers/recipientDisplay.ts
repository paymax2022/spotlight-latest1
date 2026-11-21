/**
 * The address line a wallet-to-wallet confirmation shows under the recipient's
 * name.
 *
 * Extracted as a pure function so the rule is testable without rendering a
 * screen. Both transfer entry points — the full-screen TransferSheet and the
 * tab PaymentActionScreen — print this line, and they
 * must print the same thing: it is the last thing a sender reads before
 * approving an irreversible debit.
 */
import type { TransferRecipient } from '@/types/wallet';

/**
 * The secondary line under the recipient's name on a review screen.
 *
 * A cashtag send shows the handle, because that is the address the sender
 * chose and the only thing they can recognise. `handle` is null for a
 * phone/email preview — including when the server omits the field entirely —
 * so those sends fall through to the masked phone exactly as before.
 */
export function recipientAddressLine(recipient: TransferRecipient): string {
  return recipient.handle || recipient.maskedPhone;
}
