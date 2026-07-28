import { NextRequest, NextResponse } from 'next/server';
import { getOptionalEnv } from '@/lib/config/env';
import { sendTransactionalEmail } from '@/lib/email/transactional';

type SponsorMeetingPayload = {
  organization?: string;
  contactName?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  sector?: string;
  sponsorshipInterest?: string;
  preferredDate?: string;
  preferredTime?: string;
  durationMinutes?: number;
  location?: string;
  objectives?: string;
  consent?: boolean;
};

const LOCATION = 'Virtual';
const LAGOS_OFFSET = '+01:00';

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

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function formatIcsDate(date: Date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    'T',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    'Z',
  ].join('');
}

function escapeIcs(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll('\n', '\\n');
}

function makeMeetingDate(date: string, time: string) {
  return new Date(`${date}T${time}:00${LAGOS_OFFSET}`);
}

function makeGoogleCalendarUrl(input: {
  title: string;
  details: string;
  location: string;
  start: Date;
  end: Date;
}) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: input.title,
    details: input.details,
    location: input.location,
    dates: `${formatIcsDate(input.start)}/${formatIcsDate(input.end)}`,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function makeIcs(input: {
  title: string;
  details: string;
  location: string;
  start: Date;
  end: Date;
  organizerEmail: string;
  attendeeEmail: string;
}) {
  const now = formatIcsDate(new Date());
  const uid = `sponsor-meeting-${crypto.randomUUID()}@spotlightng.com`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Spotlight//Sponsor Meeting Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${formatIcsDate(input.start)}`,
    `DTEND:${formatIcsDate(input.end)}`,
    `SUMMARY:${escapeIcs(input.title)}`,
    `DESCRIPTION:${escapeIcs(input.details)}`,
    `LOCATION:${escapeIcs(input.location)}`,
    `ORGANIZER;CN=Spotlight:MAILTO:${input.organizerEmail}`,
    `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:MAILTO:${input.attendeeEmail}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SponsorMeetingPayload;
    const organization = body.organization?.trim() || '';
    const contactName = body.contactName?.trim() || '';
    const jobTitle = body.jobTitle?.trim() || '';
    const email = body.email?.trim() || '';
    const phone = body.phone?.trim() || '';
    const sector = body.sector?.trim() || '';
    const sponsorshipInterest = body.sponsorshipInterest?.trim() || '';
    const preferredDate = body.preferredDate?.trim() || '';
    const preferredTime = body.preferredTime?.trim() || '';
    const durationMinutes = Number(body.durationMinutes || 30);
    const objectives = body.objectives?.trim() || '';

    if (
      !isNonEmptyString(organization) ||
      !isNonEmptyString(contactName) ||
      !isNonEmptyString(email) ||
      !isNonEmptyString(phone) ||
      !isNonEmptyString(sector) ||
      !isNonEmptyString(sponsorshipInterest) ||
      !isNonEmptyString(preferredDate) ||
      !isNonEmptyString(preferredTime) ||
      !isNonEmptyString(objectives)
    ) {
      return NextResponse.json({ ok: false, message: 'Please complete all required fields.' }, { status: 400 });
    }

    if (!hasBasicEmail(email)) {
      return NextResponse.json({ ok: false, message: 'Invalid email format.' }, { status: 400 });
    }

    if (body.consent !== true) {
      return NextResponse.json({ ok: false, message: 'Consent is required.' }, { status: 400 });
    }

    if (body.location && body.location !== LOCATION) {
      return NextResponse.json({ ok: false, message: 'Meeting location must remain Virtual.' }, { status: 400 });
    }

    if (![30, 45, 60].includes(durationMinutes)) {
      return NextResponse.json({ ok: false, message: 'Select a valid meeting duration.' }, { status: 400 });
    }

    const start = makeMeetingDate(preferredDate, preferredTime);
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

    if (Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) {
      return NextResponse.json({ ok: false, message: 'Choose a future meeting date and time.' }, { status: 400 });
    }

    const inboxEmail =
      getOptionalEnv('SPONSOR_INBOX_EMAIL') ||
      getOptionalEnv('CONTACT_INBOX_EMAIL') ||
      getOptionalEnv('SUPPORT_EMAIL') ||
      'info@spotlightng.com';

    const title = `Spotlight sponsor meeting: ${organization}`;
    const details = [
      `Organization: ${organization}`,
      `Contact: ${contactName}${jobTitle ? ` (${jobTitle})` : ''}`,
      `Email: ${email}`,
      `Phone: ${phone}`,
      `Sector: ${sector}`,
      `Sponsorship Interest: ${sponsorshipInterest}`,
      `Location: ${LOCATION}`,
      '',
      'Objectives:',
      objectives,
    ].join('\n');

    const googleCalendarUrl = makeGoogleCalendarUrl({
      title,
      details,
      location: LOCATION,
      start,
      end,
    });
    const ics = makeIcs({
      title,
      details,
      location: LOCATION,
      start,
      end,
      organizerEmail: inboxEmail,
      attendeeEmail: email,
    });

    const subject = `[Sponsor Meeting] ${organization} - ${preferredDate} ${preferredTime}`;
    const text = [
      'New sponsor meeting request',
      '',
      details,
      '',
      `Requested Date: ${preferredDate}`,
      `Requested Time: ${preferredTime} WAT`,
      `Duration: ${durationMinutes} minutes`,
      `Google Calendar: ${googleCalendarUrl}`,
      '',
      'Calendar invite (.ics):',
      ics,
    ].join('\n');

    const html = `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
        <h2 style="margin-bottom: 12px;">New Sponsor Meeting Request</h2>
        <p><strong>Organization:</strong> ${safe(organization)}</p>
        <p><strong>Contact:</strong> ${safe(contactName)}${jobTitle ? ` (${safe(jobTitle)})` : ''}</p>
        <p><strong>Email:</strong> ${safe(email)}</p>
        <p><strong>Phone:</strong> ${safe(phone)}</p>
        <p><strong>Sector:</strong> ${safe(sector)}</p>
        <p><strong>Sponsorship Interest:</strong> ${safe(sponsorshipInterest)}</p>
        <p><strong>Meeting:</strong> ${safe(preferredDate)} at ${safe(preferredTime)} WAT for ${durationMinutes} minutes</p>
        <p><strong>Location:</strong> ${LOCATION}</p>
        <p><strong>Objectives:</strong></p>
        <div style="padding: 12px; border: 1px solid #e5e7eb; white-space: pre-wrap;">${safe(objectives)}</div>
        <p><a href="${safe(googleCalendarUrl)}">Add to Google Calendar</a></p>
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
          message: `Meeting request captured but email delivery failed: ${delivery.reason}`,
          emailDelivery: delivery,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: 'Your sponsor meeting request has been sent. Our team will confirm the virtual meeting link shortly.',
      data: {
        receivedAt: new Date().toISOString(),
        location: LOCATION,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        googleCalendarUrl,
        ics,
      },
      emailDelivery: delivery,
    });
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid request payload.' }, { status: 400 });
  }
}
