/**
 * Open Mic admin applicant actions — the write half of the Applications tab.
 *
 * WHY THIS EXISTS
 * The tab could list applicants but could not do anything about them: the read
 * adapter (open-mic-applicants.ts) was built to answer "who applied", and the
 * decisions themselves — approve, shortlist, waitlist, reject, disqualify, ask
 * for more information, withdraw — only existed on /admin/registration. An
 * admin working an Open Mic edition had to leave the contest to act on the very
 * applicants the contest page was showing them.
 *
 * WHERE THE WRITES GO
 * Every status change goes through `reviewRegistrationApplication`, the same
 * store function /admin/registration/applications/:id/reuse calls, which is
 * itself the only writer of `registrations.status`. That is deliberate:
 *   - the DB CHECK constraint on `registrations.status` is the authority on
 *     which values exist, and this list is a subset of it;
 *   - promoting an approvable status into the `contestants` roster (and
 *     deactivating that roster row on reject/disqualify/withdraw/eliminate) is
 *     the RPC's job — reimplementing it here would create a second, subtly
 *     different promotion path, which is exactly the split that produced the
 *     empty Applications tab in the first place;
 *   - `withdraw` needs no new route: the RPC stamps `withdrawn_at` when the
 *     status is 'withdrawn' (see the review RPC), so an admin cancellation is
 *     the same write the applicant's own withdrawal would have been, just with
 *     an admin actor.
 * Nothing in `src/server/openmic/persistence.ts`, `src/server/registration/
 * store.ts` or any other brownfield-protected file is modified. New behaviour
 * lives in registration-v2/ as CLAUDE.md § Brownfield safety requires.
 *
 * THE CONTEST GUARD
 * Rows on this tab carry ids from two planes, so an id arriving here is not
 * proof of anything. Each write re-reads the application and checks it belongs
 * to the contest in the URL before touching it: a legacy
 * `competition_enrollments` id has no `registrations` row and must fail loudly,
 * and an application belonging to another contest must never be writable
 * through the Open Mic console.
 *
 * TESTABILITY
 * Reads, writes and the mailer all arrive through `OpenMicApplicantActionSources`
 * so the decisions are covered without a Supabase client. The default sources
 * load lazily: importing this module must not construct one.
 */
import { ApiError } from '@/src/lib/api/responses';
import type { ApplicationStatus, RegistrationDraft, RegistrationReviewInput } from '@/src/features/registration/types';

/** The decisions an admin may take on an Open Mic applicant. */
export const OPEN_MIC_APPLICANT_ACTIONS = [
  'approve',
  'shortlist',
  'waitlist',
  'reject',
  'disqualify',
  'request_information',
  'withdraw',
] as const;

export type OpenMicApplicantAction = (typeof OPEN_MIC_APPLICANT_ACTIONS)[number];

/**
 * 'winner' and 'eliminated' are real statuses but not admin actions: the winner
 * comes from the vote, 'eliminated' would collide with reject/disqualify with
 * nothing in the audit trail to tell them apart, and 'draft'/'submitted' belong
 * to the applicant, not the reviewer.
 */
const STATUS_BY_ACTION: Record<OpenMicApplicantAction, ApplicationStatus> = {
  approve: 'approved',
  shortlist: 'shortlisted',
  waitlist: 'waitlisted',
  reject: 'rejected',
  disqualify: 'disqualified',
  request_information: 'more_information_requested',
  withdraw: 'withdrawn',
};

export function isAllowedOpenMicAction(value: unknown): value is OpenMicApplicantAction {
  return typeof value === 'string' && (OPEN_MIC_APPLICANT_ACTIONS as readonly string[]).includes(value);
}

export function openMicStatusForAction(action: OpenMicApplicantAction): ApplicationStatus {
  return STATUS_BY_ACTION[action];
}

export type OpenMicApplicantActionSources = {
  /** The contest's slug and title, or null when the id matches nothing. */
  findContest: (contestId: string) => Promise<{ slug: string; title: string } | null>;
  /** The live application, or null for a legacy enrollment-plane id. */
  findApplication: (applicationId: string) => Promise<RegistrationDraft | null>;
  /** The single writer of registrations.status — shared with /admin/registration. */
  review: (applicationId: string, input: RegistrationReviewInput) => Promise<RegistrationDraft | null>;
  /** Merged values written onto `registrations.form_data`. */
  writeContact: (applicationId: string, values: Record<string, string>) => Promise<void>;
  /** Resolves false when the mailer had no provider configured (dev), throws on a real failure. */
  mail: (to: string, subject: string, html: string) => Promise<boolean>;
};

export type OpenMicApplicantStatusInput = {
  contestId: string;
  applicationId: string;
  action: OpenMicApplicantAction;
  note?: string;
};

export type OpenMicApplicantStatusResult = {
  status: ApplicationStatus;
  /**
   * False when no email was due, when the applicant has no address on file,
   * when the send failed, or when the mailer had no provider configured — a
   * dev machine logs the message and sends nothing, and that is not delivered.
   */
  emailDelivered: boolean;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value);
}

/** Same precedence the read adapter uses, so the address mailed is the address shown. */
function applicantEmail(draft: RegistrationDraft): string {
  const data = draft.formData || {};
  return text(data['personal.email']) || text(data['account.email']);
}

function applicantName(draft: RegistrationDraft): string {
  const data = draft.formData || {};
  return text(data['personal.stageName'])
    || [text(data['personal.firstName']), text(data['personal.lastName'])].filter(Boolean).join(' ');
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The information-request email. The note is admin free text heading into HTML,
 * so it is escaped here rather than interpolated raw — and the applicant's own
 * name is escaped too, because it is applicant-supplied for the same reason.
 */
export function informationRequestEmail(input: {
  stageName?: string;
  artistName?: string;
  contestTitle: string;
  note: string;
}): { subject: string; html: string } {
  const name = input.stageName?.trim() || input.artistName?.trim() || 'there';
  const title = esc(input.contestTitle);
  return {
    subject: `Action needed: more information for your ${input.contestTitle} application`,
    html: `<p>Hi ${esc(name)},</p>
<p>An administrator has reviewed your application for <strong>${title}</strong> and needs more information before it can move forward.</p>
<p><strong>What we need:</strong> ${esc(input.note)}</p>
<p>Reply to this email or update your application from the link you used to apply. Your place in the competition is held while we wait.</p>`,
  };
}

export async function applyOpenMicApplicantStatus(
  input: OpenMicApplicantStatusInput,
  sources: OpenMicApplicantActionSources,
): Promise<OpenMicApplicantStatusResult> {
  if (!isAllowedOpenMicAction(input.action)) {
    throw new ApiError(`Unsupported Open Mic applicant action: ${String(input.action)}`, 400);
  }

  const contest = await sources.findContest(input.contestId);
  if (!contest?.slug) throw new ApiError('Open Mic contest not found for this applicant action.', 404);

  const application = await sources.findApplication(input.applicationId);
  if (!application) {
    throw new ApiError(
      'This applicant predates the apply form and is not editable from this contest.',
      404,
    );
  }
  // The console is scoped to one contest; an id from another contest is not a
  // request this route was ever meant to serve.
  if (application.contestSlug !== contest.slug) {
    throw new ApiError('This applicant does not belong to this contest.', 403);
  }

  const note = text(input.note) || undefined;
  // A request with nothing in it is a status the applicant cannot act on.
  if (input.action === 'request_information' && !note) {
    throw new ApiError('Tell the applicant what information you need.', 400);
  }

  const status = openMicStatusForAction(input.action);
  const updated = await sources.review(input.applicationId, { status, note });
  if (!updated) {
    throw new ApiError('Applicant could not be updated — the application is no longer readable.', 404);
  }

  if (input.action !== 'request_information') return { status, emailDelivered: false };

  // Address and name come from the record this route already verified, not from
  // the write's return value: a review never changes who applied, and reading
  // the applicant out of the decision response would let an unexpected payload
  // silently redirect mail to a different person.
  const to = applicantEmail(application);
  if (!to) return { status, emailDelivered: false };

  const email = informationRequestEmail({
    stageName: text(application.formData?.['personal.stageName']),
    artistName: applicantName(application),
    contestTitle: contest.title || contest.slug,
    // text(input.note) is re-read rather than reusing `note`: the guard above
    // already proved it is not blank for this action, and the optional-typed
    // `note` variable cannot carry that proof into the email builder's
    // required field.
    note: text(input.note),
  });

  try {
    // `sent` rather than a bare await: a mailer with no provider configured
    // (dev, CI) resolves false without throwing, and telling an operator
    // "the applicant was emailed" then would describe a message nobody got.
    const sent = await sources.mail(to, email.subject, email.html);
    return { status, emailDelivered: Boolean(sent) };
  } catch (err) {
    // The decision is already written; a mail outage is reported, not fatal.
    console.error('[open-mic] information request email failed:', err instanceof Error ? err.message : err);
    return { status, emailDelivered: false };
  }
}

export type OpenMicApplicantContactPatch = {
  email?: string;
  phone?: string;
  stageName?: string;
};

export type OpenMicApplicantContactInput = {
  contestId: string;
  applicationId: string;
  patch: OpenMicApplicantContactPatch;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9][0-9\s-]{6,19}$/;
const STAGE_NAME_MAX = 80;

/**
 * Contact fields are the ones an applicant gets wrong most often and that the
 * console cannot recover from later: a mistyped email means no information
 * request ever arrives, a mistyped phone means nobody can call them. Everything
 * is validated before the write so a half-corrected record is never stored, and
 * both email fields move together — `personal.email` and `account.email` are
 * read as one address by the applications list, and letting them diverge would
 * recreate exactly the "two rows, one person" problem the adapter dedupes.
 */
export function validateOpenMicApplicantContact(
  patch: OpenMicApplicantContactPatch,
): Record<string, string> {
  const values: Record<string, string> = {};
  let touched = 0;

  if (patch.email !== undefined) {
    touched += 1;
    const email = text(patch.email);
    if (!EMAIL_RE.test(email)) throw new ApiError('A valid email address is required.', 400);
    values['personal.email'] = email;
    values['account.email'] = email;
  }
  if (patch.phone !== undefined) {
    touched += 1;
    const phone = text(patch.phone);
    if (!PHONE_RE.test(phone)) throw new ApiError('A reachable phone number is required.', 400);
    values['personal.primaryPhone'] = phone;
  }
  if (patch.stageName !== undefined) {
    touched += 1;
    const stageName = text(patch.stageName);
    if (!stageName) {
      throw new ApiError('A stage name cannot be blank — clear it from the application form instead.', 400);
    }
    if (stageName.length > STAGE_NAME_MAX) {
      throw new ApiError(`A stage name must be ${STAGE_NAME_MAX} characters or fewer.`, 400);
    }
    values['personal.stageName'] = stageName;
  }

  if (!touched) throw new ApiError('Nothing to update — provide at least one contact field.', 400);
  return values;
}

export async function editOpenMicApplicantContact(
  input: OpenMicApplicantContactInput,
  sources: OpenMicApplicantActionSources,
): Promise<void> {
  const values = validateOpenMicApplicantContact(input.patch);

  const contest = await sources.findContest(input.contestId);
  if (!contest?.slug) throw new ApiError('Open Mic contest not found for this applicant edit.', 404);

  const application = await sources.findApplication(input.applicationId);
  if (!application) {
    throw new ApiError('This applicant predates the apply form and is not editable from this contest.', 404);
  }
  if (application.contestSlug !== contest.slug) {
    throw new ApiError('This applicant does not belong to this contest.', 403);
  }

  await sources.writeContact(input.applicationId, values);
}

/**
 * The real reads, writes and mailer, loaded lazily so importing this module
 * never opens a client. `review` is imported, not reimplemented — it stays the
 * only path that promotes or deactivates a `contestants` roster row.
 */
export const defaultOpenMicApplicantActionSources: OpenMicApplicantActionSources = {
  findContest: async (contestId) => {
    const { createAdminClient } = await import('@/lib/supabase/server');
    // `name`, not `title`: that is the column `contests` actually has (verified
    // against the schema). The field is called title in the sources type
    // because the email sentence wants a title, and mapping it here keeps that
    // wording out of the caller.
    const { data, error } = await createAdminClient()
      .from('contests')
      .select('slug, name')
      .eq('id', contestId)
      .maybeSingle();
    if (error) throw new Error(`Open Mic contest unreadable: ${error.message}`);
    if (!data) return null;
    return {
      slug: String((data as { slug?: unknown }).slug || ''),
      title: String((data as { name?: unknown }).name || ''),
    };
  },
  findApplication: async (applicationId) => {
    const { getRegistrationDraft } = await import('@/src/server/registration/supabase-store');
    return getRegistrationDraft(applicationId);
  },
  review: async (applicationId, reviewInput) => {
    const { reviewRegistrationApplication } = await import('@/src/server/registration/supabase-store');
    return reviewRegistrationApplication(applicationId, reviewInput);
  },
  writeContact: async (applicationId, values) => {
    const { createAdminClient } = await import('@/lib/supabase/server');
    const { getRegistrationDraft } = await import('@/src/server/registration/supabase-store');
    const current = await getRegistrationDraft(applicationId);
    if (!current) throw new Error('Application no longer readable');
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('registrations')
      .update({
        form_data: { ...(current.formData || {}), ...values },
        updated_at: new Date().toISOString(),
      })
      .eq('id', applicationId);
    if (error) throw new Error(`Contact update failed: ${error.message}`);
  },
  mail: async (to, subject, html) => {
    const { sendEmail } = await import('@/src/server/notifications/email');
    // Passed through, not awaited-and-discarded: sendEmail's boolean is the
    // difference between "emailed" and "logged only because there is no
    // RESEND_API_KEY here".
    return sendEmail(to, subject, html);
  },
};
