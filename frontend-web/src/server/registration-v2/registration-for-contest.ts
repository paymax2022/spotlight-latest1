// "Have I already applied to this contest?" — the lookup the apply button needs.
//
// WHY THIS EXISTS
// The mobile contest screen offered "Register / Apply to Compete" unconditionally,
// so an applicant who had already applied simply applied again. One account
// accumulated five applications to `open-mic-competition`, two of them approved.
// Nothing in the UI was wrong about its own state — it had no way to know.
//
// The join is awkward enough to be worth centralising: the voting app addresses
// a contest by `connect_contests.id`, while `registrations` keys on
// `contest_slug` (TEXT). Resolving one to the other is the whole job here.
//
// Terminal statuses are deliberately NOT live: a rejected or withdrawn applicant
// is allowed to apply again, and the partial unique index added in migration
// 20270125000000 uses this same status set as its predicate. Keep the two lists
// in step — the index is the authority, this is the friendly error.
import { createAdminClient } from '@/lib/supabase/server';

/** Statuses that mean "this application is over" and free the user to reapply. */
export const TERMINAL_REGISTRATION_STATUSES = [
  'withdrawn',
  'rejected',
  'disqualified',
  'eliminated',
] as const;

export interface ExistingRegistration {
  id: string;
  status: string;
  contestSlug: string;
  reference: string | null;
  currentStep: string | null;
  createdAt: string | null;
  submittedAt: string | null;
  /** True once the applicant has actually submitted, not merely started a draft. */
  submitted: boolean;
}

/**
 * Resolve a `connect_contests.id` to the slug `registrations` stores. Returns
 * null when the contest does not exist, which the callers treat as "no
 * registration" rather than an error — a stale contest id in a deep link should
 * not break the screen.
 */
export async function contestSlugForId(contestId: string): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from('connect_contests')
    .select('slug')
    .eq('id', contestId)
    .maybeSingle();

  if (error || !data?.slug) return null;
  return data.slug as string;
}

/**
 * The user's live application for a contest, or null. Accepts either addressing
 * mode so mobile (which knows the contest id) and the registration wizard (which
 * knows the slug) can both ask.
 */
export async function findLiveRegistrationForContest(
  userId: string,
  target: { contestId?: string; contestSlug?: string },
): Promise<ExistingRegistration | null> {
  const slug = target.contestSlug
    ? target.contestSlug
    : target.contestId
      ? await contestSlugForId(target.contestId)
      : null;

  if (!slug) return null;

  const { data, error } = await createAdminClient()
    .from('registrations')
    .select('id, status, contest_slug, reference, current_step, created_at, submitted_at')
    .eq('user_id', userId)
    .eq('contest_slug', slug)
    .not('status', 'in', `(${TERMINAL_REGISTRATION_STATUSES.join(',')})`)
    // The unique index makes this at most one row, but ordering keeps the result
    // deterministic for any data that predates the index.
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to look up existing registration: ${error.message}`);
  }

  const row = (data || [])[0];
  if (!row) return null;

  return {
    id: row.id as string,
    status: row.status as string,
    contestSlug: row.contest_slug as string,
    reference: (row.reference as string | null) ?? null,
    currentStep: (row.current_step as string | null) ?? null,
    createdAt: (row.created_at as string | null) ?? null,
    submittedAt: (row.submitted_at as string | null) ?? null,
    submitted: Boolean(row.submitted_at),
  };
}

/**
 * Thrown when a user tries to start a second live application for a contest.
 * Carries the application they already have so the caller can send them there
 * instead of reporting a dead end.
 */
export class RegistrationExistsError extends Error {
  readonly code = 'registration_exists';
  readonly registration: ExistingRegistration;

  constructor(registration: ExistingRegistration) {
    super('You have already applied to this contest.');
    this.name = 'RegistrationExistsError';
    this.registration = registration;
  }
}
