import { getOptionalEnv } from '@/lib/config/env';
import { sendTransactionalEmail } from '@/lib/email/transactional';

function formatNaira(amount: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
  }).format(amount);
}

function getSiteUrl() {
  return getOptionalEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:4028') || 'http://localhost:4028';
}

export async function sendSpotlightRegistrationEmail(input: {
  email: string;
  fullName: string;
  paymentReference: string;
}) {
  const siteUrl = getSiteUrl();

  return sendTransactionalEmail({
    to: input.email,
    subject: 'Spotlight Registration Confirmed',
    text: [
      `Hello ${input.fullName},`,
      '',
      'Your Spotlight registration has been confirmed successfully.',
      `Payment Reference: ${input.paymentReference}`,
      '',
      `Continue here: ${siteUrl}/user-dashboard`,
      '',
      'Spotlight Team',
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
        <h2 style="margin-bottom: 12px;">Registration Confirmed</h2>
        <p>Hello ${input.fullName},</p>
        <p>Your Spotlight registration has been confirmed successfully.</p>
        <p><strong>Payment Reference:</strong> ${input.paymentReference}</p>
        <p>
          Continue here:
          <a href="${siteUrl}/user-dashboard">${siteUrl}/user-dashboard</a>
        </p>
        <p>Spotlight Team</p>
      </div>
    `,
  });
}

export async function sendAcademyApplicationReceivedEmail(input: {
  email: string;
  fullName: string;
  batchName?: string | null;
  paymentRequired: boolean;
  applicationFee: number;
}) {
  const siteUrl = getSiteUrl();
  const batchLabel = input.batchName || 'Film Academy';
  const feeText = input.paymentRequired
    ? `Application Fee: ${formatNaira(input.applicationFee)}`
    : 'Application Fee: Not required';

  return sendTransactionalEmail({
    to: input.email,
    subject: 'Spotlight Film Academy Application Received',
    text: [
      `Hello ${input.fullName},`,
      '',
      'Your Film Academy application has been received.',
      `Batch: ${batchLabel}`,
      feeText,
      '',
      `Track your application: ${siteUrl}/film-academy/dashboard`,
      '',
      'Spotlight Team',
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
        <h2 style="margin-bottom: 12px;">Application Received</h2>
        <p>Hello ${input.fullName},</p>
        <p>Your Film Academy application has been received.</p>
        <div style="padding: 16px; border: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="margin: 0 0 8px;"><strong>Batch:</strong> ${batchLabel}</p>
          <p style="margin: 0;">${feeText}</p>
        </div>
        <p>
          Track your application:
          <a href="${siteUrl}/film-academy/dashboard">${siteUrl}/film-academy/dashboard</a>
        </p>
        <p>Spotlight Team</p>
      </div>
    `,
  });
}

export async function sendAuditionRegistrationEmail(input: {
  email: string;
  fullName: string;
  registrationNumber: string;
  scheduleTitle?: string | null;
  auditionDate?: string | null;
  startTime?: string | null;
  venue?: string | null;
  city?: string | null;
  state?: string | null;
}) {
  const siteUrl = getSiteUrl();
  const scheduleLabel = input.scheduleTitle || 'Spotlight Audition';
  const venueLine = [input.venue, input.city, input.state].filter(Boolean).join(', ');
  const dateLine = [input.auditionDate, input.startTime].filter(Boolean).join(' • ');

  return sendTransactionalEmail({
    to: input.email,
    subject: 'Spotlight Audition Registration Confirmed',
    text: [
      `Hello ${input.fullName},`,
      '',
      'Your audition registration has been confirmed.',
      `Registration Number: ${input.registrationNumber}`,
      `Schedule: ${scheduleLabel}`,
      dateLine ? `Date/Time: ${dateLine}` : '',
      venueLine ? `Venue: ${venueLine}` : '',
      '',
      `More info: ${siteUrl}/audition-register`,
      '',
      'Spotlight Team',
    ]
      .filter(Boolean)
      .join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
        <h2 style="margin-bottom: 12px;">Audition Registration Confirmed</h2>
        <p>Hello ${input.fullName},</p>
        <p>Your audition registration has been confirmed.</p>
        <div style="padding: 16px; border: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="margin: 0 0 8px;"><strong>Registration Number:</strong> ${input.registrationNumber}</p>
          <p style="margin: 0 0 8px;"><strong>Schedule:</strong> ${scheduleLabel}</p>
          ${dateLine ? `<p style="margin: 0 0 8px;"><strong>Date/Time:</strong> ${dateLine}</p>` : ''}
          ${venueLine ? `<p style="margin: 0;"><strong>Venue:</strong> ${venueLine}</p>` : ''}
        </div>
        <p>
          More info:
          <a href="${siteUrl}/audition-register">${siteUrl}/audition-register</a>
        </p>
        <p>Spotlight Team</p>
      </div>
    `,
  });
}

export async function sendContestantRegistrationEmail(input: {
  email: string;
  fullName: string;
  votingLink: string;
}) {
  return sendTransactionalEmail({
    to: input.email,
    subject: 'Spotlight Contestant Registration Received',
    text: [
      `Hello ${input.fullName},`,
      '',
      'Your contestant registration has been received.',
      `Your voting link: ${input.votingLink}`,
      '',
      'Share your link and invite supporters to vote.',
      '',
      'Spotlight Team',
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
        <h2 style="margin-bottom: 12px;">Contestant Registration Received</h2>
        <p>Hello ${input.fullName},</p>
        <p>Your contestant registration has been received.</p>
        <p>
          <strong>Your voting link:</strong>
          <a href="${input.votingLink}">${input.votingLink}</a>
        </p>
        <p>Share your link and invite supporters to vote.</p>
        <p>Spotlight Team</p>
      </div>
    `,
  });
}

export async function sendMusicCompetitionEnrollmentEmail(input: {
  email: string;
  stageName: string;
  competitionName: string;
  competitionSlug?: string | null;
}) {
  const siteUrl = getSiteUrl();
  const joinLink = input.competitionSlug
    ? `${siteUrl}/competitions/${input.competitionSlug}/submit`
    : `${siteUrl}/user-dashboard`;

  return sendTransactionalEmail({
    to: input.email,
    subject: `${input.competitionName} Enrollment Confirmed`,
    text: [
      `Hello ${input.stageName},`,
      '',
      `Your enrollment for ${input.competitionName} is confirmed.`,
      '',
      `Continue your submission flow: ${joinLink}`,
      '',
      'Spotlight Team',
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
        <h2 style="margin-bottom: 12px;">Enrollment Confirmed</h2>
        <p>Hello ${input.stageName},</p>
        <p>Your enrollment for <strong>${input.competitionName}</strong> is confirmed.</p>
        <p>
          Continue your submission flow:
          <a href="${joinLink}">${joinLink}</a>
        </p>
        <p>Spotlight Team</p>
      </div>
    `,
  });
}

export async function sendMusicEntrySubmittedEmail(input: {
  email: string;
  stageName: string;
  competitionName: string;
  competitionSlug?: string | null;
  entryTitle: string;
}) {
  const siteUrl = getSiteUrl();
  const trackingLink = input.competitionSlug
    ? `${siteUrl}/competitions/${input.competitionSlug}/submit`
    : `${siteUrl}/user-dashboard`;

  return sendTransactionalEmail({
    to: input.email,
    subject: `${input.competitionName} Entry Submitted`,
    text: [
      `Hello ${input.stageName},`,
      '',
      `We received your entry "${input.entryTitle}" for ${input.competitionName}.`,
      'Your submission is now pending moderation review.',
      '',
      `Track status: ${trackingLink}`,
      '',
      'Spotlight Team',
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
        <h2 style="margin-bottom: 12px;">Entry Submitted</h2>
        <p>Hello ${input.stageName},</p>
        <p>We received your entry <strong>${input.entryTitle}</strong> for <strong>${input.competitionName}</strong>.</p>
        <p>Your submission is now pending moderation review.</p>
        <p>
          Track status:
          <a href="${trackingLink}">${trackingLink}</a>
        </p>
        <p>Spotlight Team</p>
      </div>
    `,
  });
}

export async function sendMusicModerationUpdateEmail(input: {
  email: string;
  stageName: string;
  competitionName: string;
  competitionSlug?: string | null;
  entryTitle: string;
  action: string;
  status: string;
  feedback?: string;
}) {
  const siteUrl = getSiteUrl();
  const dashboardLink = input.competitionSlug
    ? `${siteUrl}/competitions/${input.competitionSlug}/submit`
    : `${siteUrl}/user-dashboard`;
  const normalizedAction = input.action.replace(/_/g, ' ');
  const feedbackBlock = input.feedback?.trim() ? `Feedback: ${input.feedback.trim()}` : '';

  return sendTransactionalEmail({
    to: input.email,
    subject: `${input.competitionName} Entry Update`,
    text: [
      `Hello ${input.stageName},`,
      '',
      `Your entry "${input.entryTitle}" has a new moderation update.`,
      `Action: ${normalizedAction}`,
      `Current Status: ${input.status}`,
      feedbackBlock,
      '',
      `Review your entry: ${dashboardLink}`,
      '',
      'Spotlight Team',
    ]
      .filter(Boolean)
      .join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
        <h2 style="margin-bottom: 12px;">Entry Moderation Update</h2>
        <p>Hello ${input.stageName},</p>
        <p>Your entry <strong>${input.entryTitle}</strong> has a new moderation update.</p>
        <div style="padding: 16px; border: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="margin: 0 0 8px;"><strong>Action:</strong> ${normalizedAction}</p>
          <p style="margin: 0 0 8px;"><strong>Current Status:</strong> ${input.status}</p>
          ${input.feedback?.trim() ? `<p style="margin: 0;"><strong>Feedback:</strong> ${input.feedback.trim()}</p>` : ''}
        </div>
        <p>
          Review your entry:
          <a href="${dashboardLink}">${dashboardLink}</a>
        </p>
        <p>Spotlight Team</p>
      </div>
    `,
  });
}
