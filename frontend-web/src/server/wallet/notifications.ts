/**
 * WAL-002: no notification fired on wallet top-up success or a failed/rejected
 * webhook — a real gap, not a design ambiguity (unlike WAL-001). Follows this
 * project's documented email convention (CLAUDE.md: Resend API, fire-and-forget,
 * failures silent) rather than the separate Mailgun-based `sendTransactionalEmail`
 * used by the registration/academy modules — the two email paths coexisting is a
 * pre-existing inconsistency outside this fix's scope, flagged, not resolved here.
 * Mirrors `src/server/voting/email.service.ts`'s exact `sendEmail` shape.
 *
 * Push notifications were deliberately NOT built: `device_push_tokens` (written
 * by `app/api/v1/notifications/push-token/route.ts`) has no consumer anywhere in
 * the codebase — building a full push-delivery pipeline from scratch is a
 * materially bigger, distinct piece of work than closing this specific gap, and
 * would be its own net-new subsystem.
 */

function formatNaira(kobo: number): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(kobo / 100);
}

function escHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'Spotlight <no-reply@spotlightng.com>';

  if (!apiKey) {
    console.log(`[wallet-email] To: ${to} | Subject: ${subject}`);
    return;
  }

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
}

function wrapEmail(headline: string, accentColor: string, bodyHtml: string): string {
  return `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#f9fafb;padding:32px">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
  <div style="background:${accentColor};padding:20px 28px">
    <h1 style="margin:0;color:#fff;font-size:18px">${headline}</h1>
  </div>
  <div style="padding:24px 28px">
    ${bodyHtml}
    <p style="font-size:12px;color:#9ca3af;margin-top:24px">
      If you didn't expect this, contact support immediately.
    </p>
  </div>
</div>
</body>
</html>`;
}

/** Fire-and-forget by design — a failed send must never break settlement. */
function safeSend(promise: Promise<void>, context: string): void {
  promise.catch((err) => {
    console.error(`[wallet-email] ${context} failed to send:`, err instanceof Error ? err.message : err);
  });
}

export function notifyTopupSuccess(input: { to: string; amountKobo: number; reference: string }): void {
  const html = wrapEmail(
    'Top-up Successful ✅',
    '#10b981',
    `
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="color:#6b7280;padding:6px 0">Amount</td><td style="font-weight:700;text-align:right;color:#10b981;font-size:16px">${formatNaira(input.amountKobo)}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0">Reference</td><td style="text-align:right;font-size:12px;font-family:monospace">${escHtml(input.reference)}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0">Date</td><td style="text-align:right">${new Date().toLocaleString()}</td></tr>
    </table>
    <p style="margin-top:16px">Your wallet has been credited.</p>
  `,
  );
  safeSend(sendEmail(input.to, `Wallet top-up successful — ${formatNaira(input.amountKobo)}`, html), 'topup-success');
}

export function notifyTopupFailed(input: { to: string; amountKobo: number; reference: string; reason: string }): void {
  const html = wrapEmail(
    'Top-up Failed',
    '#dc2626',
    `
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="color:#6b7280;padding:6px 0">Amount</td><td style="text-align:right">${formatNaira(input.amountKobo)}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0">Reference</td><td style="text-align:right;font-size:12px;font-family:monospace">${escHtml(input.reference)}</td></tr>
    </table>
    <p style="margin-top:16px">Your top-up could not be completed and no funds were credited to your wallet. Please try again, or contact support with the reference above if you were charged and need help.</p>
  `,
  );
  safeSend(sendEmail(input.to, "Wallet top-up couldn't be completed", html), 'topup-failed');
}
