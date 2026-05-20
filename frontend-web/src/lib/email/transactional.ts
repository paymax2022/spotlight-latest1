import { getOptionalEnv } from '@/lib/config/env';

type TransactionalEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

type MailgunResponse = {
  id?: string;
  message?: string;
};

type TransactionalEmailResult =
  | {
      sent: true;
      provider: 'mailgun';
      id: string | null;
    }
  | {
      sent: false;
      provider: 'none' | 'mailgun';
      reason: string;
    };

function getMailgunBaseUrl() {
  const region = getOptionalEnv('MAILGUN_REGION', 'US')?.toUpperCase();
  return region === 'EU' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
}

export async function sendTransactionalEmail(
  input: TransactionalEmailInput
): Promise<TransactionalEmailResult> {
  const mailgunApiKey = getOptionalEnv('MAILGUN_API_KEY');
  const mailgunDomain = getOptionalEnv('MAILGUN_DOMAIN');
  const emailFrom = getOptionalEnv('EMAIL_FROM');
  const emailReplyTo = getOptionalEnv('EMAIL_REPLY_TO');

  if (!mailgunApiKey || !mailgunDomain || !emailFrom) {
    return {
      sent: false,
      provider: 'none',
      reason: 'Mailgun is not configured.',
    };
  }

  const form = new URLSearchParams();
  form.set('from', emailFrom);
  form.set('to', input.to);
  form.set('subject', input.subject);
  form.set('text', input.text);
  form.set('html', input.html);

  if (emailReplyTo) {
    form.set('h:Reply-To', emailReplyTo);
  }

  const response = await fetch(`${getMailgunBaseUrl()}/v3/${mailgunDomain}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${mailgunApiKey}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => null)) as MailgunResponse | null;

  if (!response.ok) {
    return {
      sent: false,
      provider: 'mailgun',
      reason: payload?.message || 'Failed to send transactional email via Mailgun.',
    };
  }

  return {
    sent: true,
    provider: 'mailgun',
    id: payload?.id ?? null,
  };
}
