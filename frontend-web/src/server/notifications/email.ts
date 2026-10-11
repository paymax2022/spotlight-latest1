// Minimal transactional email via Resend. Fire-and-forget callers must catch: this
// throws on a rejected or unreachable provider so a failure is never silent.
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'Spotlight <no-reply@spotlightng.com>';

  if (!apiKey) {
    // Dev/unconfigured: log only. Never log the body (it can carry amounts and references).
    console.log(`[email] (no RESEND_API_KEY) To: ${to} | Subject: ${subject}`);
    return;
  }

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error('[email] resend request failed:', err instanceof Error ? err.message : err);
    throw err;
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 200);
    console.error(`[email] resend rejected: ${res.status} ${body}`);
    throw new Error(`resend failed: ${res.status}`);
  }
}
