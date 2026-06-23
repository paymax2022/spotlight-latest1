import { NextRequest, NextResponse } from 'next/server';
import { getOptionalEnv } from '@/lib/config/env';
import { sendTransactionalEmail } from '@/lib/email/transactional';

type ContactPayload = {
  fullName?: string;
  email?: string;
  requestType?: string;
  message?: string;
  consent?: boolean;
};

function isNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasBasicEmail(value: unknown) {
  return typeof value === 'string' && /.+@.+\..+/.test(value);
}

function safe(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ContactPayload;
    const fullName = body.fullName?.trim() || '';
    const email = body.email?.trim() || '';
    const requestType = body.requestType?.trim() || '';
    const message = body.message?.trim() || '';

    if (!isNonEmptyString(fullName) || !isNonEmptyString(email) || !isNonEmptyString(requestType) || !isNonEmptyString(message)) {
      return NextResponse.json({ ok: false, message: 'All fields are required.' }, { status: 400 });
    }

    if (!hasBasicEmail(email)) {
      return NextResponse.json({ ok: false, message: 'Invalid email format.' }, { status: 400 });
    }

    if (body.consent !== true) {
      return NextResponse.json({ ok: false, message: 'Consent is required.' }, { status: 400 });
    }

    const inboxEmail =
      getOptionalEnv('CONTACT_INBOX_EMAIL') ||
      getOptionalEnv('SUPPORT_EMAIL') ||
      'info@spotlightng.com';

    const subject = `[Contact] ${requestType} - ${fullName}`;
    const text = [
      'New contact form submission',
      '',
      `Name: ${fullName}`,
      `Email: ${email}`,
      `Request Type: ${requestType}`,
      '',
      'Message:',
      message,
    ].join('\n');

    const html = `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
        <h2 style="margin-bottom: 12px;">New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${safe(fullName)}</p>
        <p><strong>Email:</strong> ${safe(email)}</p>
        <p><strong>Request Type:</strong> ${safe(requestType)}</p>
        <p><strong>Message:</strong></p>
        <div style="padding: 12px; border: 1px solid #e5e7eb; white-space: pre-wrap;">${safe(message)}</div>
      </div>
    `;

    const delivery = await sendTransactionalEmail({
      to: inboxEmail,
      subject,
      text,
      html,
    });

    if (!delivery.sent) {
      return NextResponse.json(
        {
          ok: false,
          message: `Contact message captured but email delivery failed: ${delivery.reason}`,
          emailDelivery: delivery,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: 'Your message has been sent successfully.',
      emailDelivery: delivery,
      data: {
        receivedAt: new Date().toISOString(),
      },
    });
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid request payload.' }, { status: 400 });
  }
}

