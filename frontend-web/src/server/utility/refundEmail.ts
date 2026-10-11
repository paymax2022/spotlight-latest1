import { sendEmail } from '@/src/server/notifications/email';

function naira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Tells the customer what happened to a card-paid utility bill that could not be
 * delivered. 'held': their refund is waiting because their wallet is not active.
 * 'refunded': the money is back in their wallet. Throws on a provider failure so
 * the caller can record it; it must never block the money movement itself.
 */
export async function sendUtilityRefundEmail(
  kind: 'held' | 'refunded',
  input: { to: string; receipt: string; amountKobo: number },
): Promise<void> {
  const amount = naira(input.amountKobo);
  const receipt = esc(input.receipt);
  if (kind === 'held') {
    await sendEmail(
      input.to,
      'Action needed: activate your wallet to receive your refund',
      `<p>We could not complete your utility payment <strong>${receipt}</strong> after retrying, and your payment of <strong>${amount}</strong> is owed back to you.</p>
       <p>Your wallet is not active, so we are holding the refund safely for you. <strong>Activate your wallet</strong> in the app (or contact support if your account is restricted) and the refund will be sent to it automatically.</p>
       <p>You do not need to pay again.</p>`,
    );
    return;
  }
  await sendEmail(
    input.to,
    'Your utility payment has been refunded',
    `<p>We could not complete your utility payment <strong>${receipt}</strong> after retrying, so <strong>${amount}</strong> has been refunded to your wallet.</p>`,
  );
}
