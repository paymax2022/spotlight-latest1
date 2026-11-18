import { NextRequest, NextResponse } from 'next/server';
import { sendTransactionalEmail } from '@/lib/email';
import { sendEmail } from '@/src/server/notifications/email';
import {
  NIGERIA_CITIES_BY_STATE,
  NIGERIA_STATES,
} from '@/src/features/registration/reference-data';

// Venue partners apply straight from the Open Mic page, so this route is public
// (like /api/inquiries) rather than tied to a signed-in user.
const TEAM_INBOX = process.env.LOUNGE_APPLICATION_EMAIL_TO?.trim() || 'info@spotlightng.com';

// A bare address is what SMTP-style providers and Mailpit's send API want; the
// display name is attached separately per transport.
const SENDER_ADDRESS =
  (process.env.LOUNGE_APPLICATION_EMAIL_FROM?.trim() ||
    extractAddress(process.env.EMAIL_FROM) ||
    'no-reply@spotlightng.com');

function extractAddress(from?: string) {
  if (!from) return undefined;
  return from.match(/<([^>]+)>/)?.[1]?.trim() || (from.includes('@') ? from.trim() : undefined);
}

function hasEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value.trim());
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type LoungeApplication = {
  loungeName: string;
  contactPerson: string;
  email: string;
  phone: string;
  state: string;
  city: string;
  capacity: string;
  proposal: string;
};

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object') {
      return NextResponse.json({ ok: false, message: 'Invalid JSON body.' }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid JSON body.' }, { status: 400 });
  }

  const application: LoungeApplication = {
    loungeName: text(body.loungeName, 100),
    contactPerson: text(body.contactPerson, 100),
    email: text(body.email, 120),
    phone: text(body.phone, 30),
    state: text(body.state, 60),
    city: text(body.city, 60),
    capacity: text(body.capacity, 10),
    proposal: text(body.proposal, 750),
  };

  const invalid = validate(application);
  if (invalid) {
    return NextResponse.json({ ok: false, message: invalid }, { status: 400 });
  }

  const receivedAt = new Date().toISOString();

  // The team copy is the source of truth for the application, so it must land.
  try {
    await deliverEmail({
      to: TEAM_INBOX,
      subject: `Open Mic lounge application — ${application.loungeName}`,
      html: teamHtml(application, receivedAt),
      text: teamText(application, receivedAt),
    });
  } catch (error) {
    console.error('[lounge-application] team email failed:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { ok: false, message: 'We could not record your application right now. Please try again or email info@spotlightng.com.' },
      { status: 502 },
    );
  }

  // A confirmation to the applicant is a courtesy; failing it must not lose the
  // application the team already received.
  try {
    await deliverEmail({
      to: application.email,
      subject: 'We received your Spotlight lounge application',
      html: applicantHtml(application),
      text: applicantText(application),
    });
  } catch (error) {
    console.warn('[lounge-application] confirmation email failed:', error instanceof Error ? error.message : error);
  }

  return NextResponse.json({
    ok: true,
    message: 'Application sent. Spotlight will review your lounge and reply to your email.',
    receivedAt,
  });
}

function validate(application: LoungeApplication): string | null {
  const required: [keyof LoungeApplication, string][] = [
    ['loungeName', 'Lounge name'],
    ['contactPerson', 'Contact person'],
    ['phone', 'Phone number'],
    ['proposal', 'Sound setup and event proposal'],
  ];
  for (const [key, label] of required) {
    if (!application[key]) return `${label} is required.`;
  }

  if (!hasEmail(application.email)) return 'Enter a valid email address.';

  if (!NIGERIA_STATES.includes(application.state)) return 'Choose a valid state.';

  const cities = NIGERIA_CITIES_BY_STATE[application.state] ?? [];
  if (!cities.includes(application.city)) return 'Choose a valid city for the selected state.';

  const capacity = Number(application.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000) {
    return 'Enter a seated capacity between 1 and 100,000.';
  }

  return null;
}

async function deliverEmail(input: { to: string; subject: string; html: string; text: string }): Promise<void> {
  const mailpitUrl = process.env.MAILPIT_URL?.replace(/\/+$/, '');

  // Dev stack only: Mailpit captures the message so the flow is verifiable
  // end to end. Guarded so it can never divert mail on staging or production.
  if (mailpitUrl && process.env.NODE_ENV !== 'production') {
    const response = await fetch(`${mailpitUrl}/api/v1/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        From: { Email: SENDER_ADDRESS, Name: 'Spotlight Open Mic' },
        To: [{ Email: input.to, Name: '' }],
        Subject: input.subject,
        Text: input.text,
        HTML: input.html,
        Tags: ['open-mic-lounge-application'],
      }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Mailpit rejected the message (HTTP ${response.status}).`);
    return;
  }

  const mailgun = await sendTransactionalEmail({
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
  if (mailgun.sent) return;

  if (process.env.RESEND_API_KEY) {
    await sendEmail(input.to, input.subject, input.html);
    return;
  }

  throw new Error(mailgun.reason || 'No email provider is configured.');
}

function rows(application: LoungeApplication, receivedAt: string): string {
  const location = `${application.city}, ${application.state}`;
  const entries = [
    ['Lounge', application.loungeName],
    ['Contact person', application.contactPerson],
    ['Email', application.email],
    ['Phone', application.phone],
    ['Location', location],
    ['Seated capacity', application.capacity],
    ['Sound setup and event proposal', application.proposal],
    ['Received', new Date(receivedAt).toUTCString()],
  ];
  return entries
    .map(
      ([label, value]) =>
        `<p style="margin:0 0 10px;"><strong style="color:#6d3d76;">${escapeHtml(label)}:</strong><br />${escapeHtml(value).replace(/\n/g, '<br />')}</p>`,
    )
    .join('');
}

function teamHtml(application: LoungeApplication, receivedAt: string): string {
  return `
    <div style="font-family: Arial, sans-serif; color:#111827; line-height:1.5;">
      <h2 style="margin-bottom:12px;">New Open Mic lounge application</h2>
      <p>A venue partner applied to host Open Mic nights. Details below.</p>
      <div style="padding:16px; border:1px solid #e5e7eb; margin:20px 0;">
        ${rows(application, receivedAt)}
      </div>
      <p>Reply to ${escapeHtml(application.email)} to progress this application.</p>
    </div>
  `;
}

function teamText(application: LoungeApplication, receivedAt: string): string {
  const location = `${application.city}, ${application.state}`;
  return [
    'New Open Mic lounge application',
    '',
    `Lounge: ${application.loungeName}`,
    `Contact person: ${application.contactPerson}`,
    `Email: ${application.email}`,
    `Phone: ${application.phone}`,
    `Location: ${location}`,
    `Seated capacity: ${application.capacity}`,
    `Sound setup and event proposal: ${application.proposal}`,
    `Received: ${new Date(receivedAt).toUTCString()}`,
    '',
    `Reply to ${application.email} to progress this application.`,
  ].join('\n');
}

function applicantHtml(application: LoungeApplication): string {
  const location = `${application.city}, ${application.state}`;
  return `
    <div style="font-family: Arial, sans-serif; color:#111827; line-height:1.6;">
      <h2 style="margin-bottom:12px;">We received your lounge application</h2>
      <p>Hi ${escapeHtml(application.contactPerson)},</p>
      <p>Thanks for applying to bring ${escapeHtml(application.loungeName)} into the Spotlight Open Mic programme. Our venues team reviews applications weekly and will reply to ${escapeHtml(application.email)}.</p>
      <div style="padding:16px; border:1px solid #e5e7eb; margin:20px 0;">
        <p style="margin:0 0 8px;"><strong>Location:</strong> ${escapeHtml(location)}</p>
        <p style="margin:0;"><strong>Seated capacity:</strong> ${escapeHtml(application.capacity)}</p>
      </div>
      <p>Spotlight Open Mic</p>
    </div>
  `;
}

function applicantText(application: LoungeApplication): string {
  const location = `${application.city}, ${application.state}`;
  return [
    `Hi ${application.contactPerson},`,
    '',
    `Thanks for applying to bring ${application.loungeName} into the Spotlight Open Mic programme.`,
    'Our venues team reviews applications weekly and will reply to this address.',
    '',
    `Location: ${location}`,
    `Seated capacity: ${application.capacity}`,
    '',
    'Spotlight Open Mic',
  ].join('\n');
}
