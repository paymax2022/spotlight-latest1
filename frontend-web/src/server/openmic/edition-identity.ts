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
