/**
 * Which `contests` rows are an Open Mic edition.
 *
 * The question should have one answer, but the plane a row was created from
 * decides what its `contest_type` says. An edition created in the Open Mic admin
 * writes `one_beat_one_verse`; an edition published from the registration plane
 * (`src/server/registration-v2/publish-to-voting.ts`) writes whatever the catalog
 * entry declared, and the catalog has always called Open Mic
 * `public_voting_contest`. Every Open Mic route filtered on the first value, so a
 * registration-published edition existed in the database, looked live in the admin
 * contest list and the mobile Connect API, and was invisible to the beat, the
 * application flow and the song upload.
 *
 * Rather than a migration rewriting history, membership is decided from the data a
 * row actually carries: its type, its category, its slug.
 */
import { OPEN_MIC_CONTEST_SLUGS, OPEN_MIC_CONTEST_TYPE, OPEN_MIC_REGISTRATION_CATEGORY } from '@/src/features/openmic/constants';

export type ContestIdentityRow = {
  id?: string | null;
  slug?: string | null;
  name?: string | null;
  category?: string | null;
  contest_type?: string | null;
};

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/** Is this row the Open Mic edition, however it came to be typed? */
export function isOpenMicContestRow(row: ContestIdentityRow | null | undefined): boolean {
  if (!row) return false;
  if (normalized(row.contest_type) === OPEN_MIC_CONTEST_TYPE) return true;
  if (normalized(row.category) === OPEN_MIC_REGISTRATION_CATEGORY) return true;
  // The catalog slug is the last signal: an admin who retyped a row while leaving
  // its category alone still has an Open Mic edition, and it should behave like one.
  return OPEN_MIC_CONTEST_SLUGS.includes(normalized(row.slug));
}

/**
 * The same question asked of an APPLICATION instead of an edition.
 *
 * `registrations` has no `contest_id`, so the only link to an edition is
 * `contest_slug` — and it holds the CATALOG slug (`open-mic-competition`), not the
 * slug of the edition the admin published. What the row does carry is the identity
 * the registration plane locked onto `form_data` when the draft was created
 * (`contest.type`, `contest.category`, from `resolveAnyContest`). Reading all three
 * is what lets a catalog-slug application be recognised as Open Mic even though no
 * `contests` row answers to its slug.
 */
export type RegistrationIdentityHint = {
  slug?: string | null;
  /** `form_data['contest.type']`. */
  contestType?: string | null;
  /** `form_data['contest.category']`. */
  contestCategory?: string | null;
};

export function isOpenMicRegistration(hint: RegistrationIdentityHint | null | undefined): boolean {
  if (!hint) return false;
  if (normalized(hint.contestType) === OPEN_MIC_CONTEST_TYPE) return true;
  if (normalized(hint.contestCategory) === OPEN_MIC_REGISTRATION_CATEGORY) return true;
  return OPEN_MIC_CONTEST_SLUGS.includes(normalized(hint.slug));
}
