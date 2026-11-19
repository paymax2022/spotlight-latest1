/**
 * Open Mic admin applicants — read-side adapter over the REGISTRATION plane.
 *
 * WHY THIS EXISTS
 * "An Open Mic applicant" is written by one system and read by another:
 *
 *   write path  the public apply form (/apply/<contestSlug>) runs
 *               src/server/registration/supabase-store, which stores the
 *               application in `registrations` keyed by CONTEST SLUG, and on
 *               approval promotes a `contestants` roster row.
 *   read path   GET /api/admin/open-mic/contests/:id/applications reads
 *               openmic/persistence.listApplications(), i.e.
 *               `competition_enrollments` keyed by CONTEST ID.
 *
 * Nothing in the current apply flow writes `competition_enrollments` — the
 * split is documented in the repo's own words at
 * src/server/registration-v2/registration-voting.ts ("a promoted contestant is
 * NOT in here") and src/services/registrationAdminService.ts on the admin side
 * ("every Open Mic applicant was unreachable through the picker"). The visible
 * symptom is an Open Mic console whose Applications tab says "Nothing here
 * yet." and whose Reports tile counts 0 applicants while the same contest has
 * approved applications in /admin/registration.
 *
 * WHAT THIS DOES
 * Merges both planes into the one row shape the Applications tab already
 * renders, so the console shows whoever actually applied without touching the
 * protected legacy modules (CLAUDE.md § Brownfield safety — new behaviour
 * lives here, in registration-v2/, and the legacy route and persistence stay
 * exactly as they are).
 *
 * TESTABILITY
 * Every read arrives through `OpenMicApplicantSources`, injected by the caller,
 * so the mapping and merge are covered without a Supabase client. The default
 * sources load lazily: importing this module must not construct one.
 */
import type { OpenMicApplication, OpenMicApplicationStatus, OpenMicBeatDownloadStatus, OpenMicPaymentStatus } from '@/src/features/openmic/types';
import { OPEN_MIC_CONTEST_TYPE } from '@/src/features/openmic/constants';
import type { ApplicationStatus, RegistrationDraft } from '@/src/features/registration/types';

/** One row of the Open Mic console's Applications table, from either plane. */
export type OpenMicApplicantRow = {
  id: string;
  contestId: string;
  /** Legal/full name as the applicant typed it. */
  artistName: string;
  stageName: string;
  email: string;
  phone: string;
  applicationStatus: OpenMicApplicationStatus;
  paymentStatus: OpenMicPaymentStatus;
  /**
   * Beat downloads are only tracked on the enrollment plane (`beat_download_logs`
   * joins `competition_enrollments.id`), so a registration-plane applicant has
   * no download record to report — 'not_available' means "this plane does not
   * track it", not "this applicant was refused the beat".
   */
  beatDownloadStatus: OpenMicBeatDownloadStatus;
  appliedAt: string;
  /** Which plane the row came from, so a mixed list is never read as one table. */
  source: 'registration' | 'enrollment';
  /**
   * The applicant's exact `registrations.status`, verbatim — 'shortlisted',
   * 'more_information_requested', 'disqualified'… Registration-plane rows only
   * (the enrollment plane has no such column, so it stays undefined there).
   *
   * WHY IT IS HERE ALONGSIDE applicationStatus
   * The console's own vocabulary has three states, and the collapse above is
   * deliberate: Reports counts approved vs rejected, and a submitted draft and a
   * waitlisted one are both "still in flight" for that purpose. But the tab now
   * also *decides* — seven actions, five of which write a status the three-state
   * column cannot show. Without this field an admin clicks Shortlist, sees the
   * row change, reloads, and the row says Pending: the decision looks like it
   * was lost. The label rendering is the console's job; the truth is carried here.
   */
  registrationStatus?: string;
};

export type OpenMicApplicantSources = {
  /** The contest's slug and type, or null when the id matches nothing. */
  findContest: (contestId: string) => Promise<{ slug: string; contestType: string } | null>;
  /** Legacy `competition_enrollments` applicants for this contest id. */
  listEnrollmentApplicants: (contestId: string) => Promise<OpenMicApplicantRow[]>;
  /** `registrations` applicants for this contest slug. */
  listRegistrationDrafts: (contestSlug: string) => Promise<RegistrationDraft[]>;
};

const OPEN_MIC_PAYMENT_STATUSES: readonly OpenMicPaymentStatus[] = [
  'not_required', 'pending', 'paid', 'failed', 'waived',
];

const OPEN_MIC_BEAT_STATUSES: readonly OpenMicBeatDownloadStatus[] = [
  'not_available', 'available', 'downloaded',
];

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value);
}

/**
 * The Open Mic console has three application states; the registration wizard
 * has nineteen. Anything still in flight (draft, submitted, under review,
 * awaiting payment, asked for more info, waitlisted…) is "pending" from the
 * console's point of view — only an explicit approval or refusal is not.
 */
export function toOpenMicApplicationStatus(status: ApplicationStatus | string): OpenMicApplicationStatus {
  const value = String(status || '').toLowerCase();
  if (value === 'approved' || value === 'winner' || value === 'selected_for_public_voting'
    || value === 'selected_for_bootcamp' || value === 'shortlisted' || value === 'callback_invited'
    || value === 'audition_scheduled') return 'approved';
  if (value === 'rejected' || value === 'disqualified' || value === 'withdrawn' || value === 'eliminated') return 'rejected';
  return 'pending';
}

/**
 * A registration's own payment record, in the console's vocabulary.
 * Absent means the wizard never reached a payment decision, which for Open Mic
 * is a free entry; an unrecognised value stays 'pending' rather than silently
 * becoming 'not_required', because that would read as "nothing owed".
 */
export function toOpenMicPaymentStatus(value: unknown): OpenMicPaymentStatus {
  const raw = text(value).toLowerCase();
  if (!raw) return 'not_required';
  return (OPEN_MIC_PAYMENT_STATUSES as readonly string[]).includes(raw)
    ? (raw as OpenMicPaymentStatus)
    : 'pending';
}

/**
 * The enrollment plane is the only one that records a beat download, and its
 * column is free text on the way out of Supabase — anything unrecognised stays
 * 'not_available' rather than inventing a state the tab would render.
 */
export function toOpenMicBeatStatus(value: unknown): OpenMicBeatDownloadStatus {
  const raw = text(value).toLowerCase();
  return (OPEN_MIC_BEAT_STATUSES as readonly string[]).includes(raw)
    ? (raw as OpenMicBeatDownloadStatus)
    : 'not_available';
}

export function mapRegistrationApplicant(draft: RegistrationDraft, contestId: string): OpenMicApplicantRow {
  const formData = (draft?.formData || {}) as Record<string, unknown>;
  return {
    id: draft.id,
    contestId,
    artistName: [text(formData['personal.firstName']), text(formData['personal.lastName'])].filter(Boolean).join(' '),
    stageName: text(formData['personal.stageName']),
    email: text(formData['personal.email']) || text(formData['account.email']),
    phone: text(formData['personal.primaryPhone']) || text(formData['personal.phone']),
    applicationStatus: toOpenMicApplicationStatus(draft.status),
    // Verbatim, for the tab that makes the decisions. The line above is for the
    // tile that counts them; see the field's comment on OpenMicApplicantRow.
    registrationStatus: text(draft.status),
    paymentStatus: toOpenMicPaymentStatus(formData['payment.paymentStatus']),
    beatDownloadStatus: 'not_available',
    appliedAt: draft.submittedAt || draft.createdAt || draft.updatedAt,
    source: 'registration',
  };
}

export function mapEnrollmentApplicant(row: OpenMicApplication, contestId: string): OpenMicApplicantRow {
  return {
    id: row.id,
    contestId,
    artistName: text(row.fullName),
    stageName: text(row.stageName),
    email: text(row.email),
    phone: text(row.phone),
    applicationStatus: toOpenMicApplicationStatus(row.applicationStatus),
    paymentStatus: toOpenMicPaymentStatus(row.paymentStatus),
    beatDownloadStatus: toOpenMicBeatStatus(row.beatDownloadStatus),
    appliedAt: row.appliedAt || row.createdAt,
    source: 'enrollment',
  };
}

function emailKey(email: string): string {
  return String(email || '').trim().toLowerCase();
}

/**
 * One list from two planes, newest first.
 *
 * Deduplicated by email with the registration row winning, because an
 * applicant who applied through the live form is one person, not two — the
 * duplicate only appears when a contest has rows in both tables. A row with no
 * email is kept as-is: there is nothing to match it against, and dropping it
 * would recreate the bug this adapter fixes.
 */
export function mergeOpenMicApplicants(
  enrollmentRows: OpenMicApplicantRow[],
  registrationRows: OpenMicApplicantRow[],
): OpenMicApplicantRow[] {
  const registrationKeys = new Set(
    registrationRows.map((row) => emailKey(row.email)).filter(Boolean),
  );
  const keptEnrollments = enrollmentRows.filter((row) => {
    const key = emailKey(row.email);
    return !key || !registrationKeys.has(key);
  });
  return [...registrationRows, ...keptEnrollments].sort((a, b) =>
    String(b.appliedAt || '').localeCompare(String(a.appliedAt || '')),
  );
}

export async function listOpenMicContestApplicants(
  contestId: string,
  sources: OpenMicApplicantSources,
): Promise<OpenMicApplicantRow[]> {
  const enrollmentRows = await sources.listEnrollmentApplicants(contestId);
  const contest = await sources.findContest(contestId);

  // The registration plane is keyed by slug and is only meaningful for an Open
  // Mic edition; a non-Open-Mic or unknown contest keeps its enrollment rows
  // and nothing more, rather than pulling in applicants for a different contest.
  if (!contest?.slug || contest.contestType !== OPEN_MIC_CONTEST_TYPE) {
    return mergeOpenMicApplicants(enrollmentRows, []);
  }

  const drafts = await sources.listRegistrationDrafts(contest.slug);
  return mergeOpenMicApplicants(enrollmentRows, drafts.map((draft) => mapRegistrationApplicant(draft, contestId)));
}

/**
 * The real reads, loaded lazily so importing this module never opens a client.
 * The legacy enrollment read is imported, not reimplemented — it keeps serving
 * contests whose applicants predate the registration flow.
 */
export const defaultOpenMicApplicantSources: OpenMicApplicantSources = {
  findContest: async (contestId) => {
    const { createAdminClient } = await import('@/lib/supabase/server');
    const { data, error } = await createAdminClient()
      .from('contests')
      .select('slug, contest_type')
      .eq('id', contestId)
      .maybeSingle();
    if (error) throw new Error(`Open Mic contest unreadable: ${error.message}`);
    if (!data) return null;
    return { slug: String((data as { slug?: unknown }).slug || ''), contestType: String((data as { contest_type?: unknown }).contest_type || '') };
  },
  listEnrollmentApplicants: async (contestId) => {
    const { listApplications } = await import('@/src/server/openmic/persistence');
    const rows = await listApplications({ contestId });
    return rows.map((row) => mapEnrollmentApplicant(row, contestId));
  },
  listRegistrationDrafts: async (contestSlug) => {
    const { listRegistrationApplications } = await import('@/src/server/registration/supabase-store');
    return listRegistrationApplications({ contestSlug });
  },
};
