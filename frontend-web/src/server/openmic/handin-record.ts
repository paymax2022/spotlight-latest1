// The signed-in artist's own Open Mic application, as far as the hand-in form is
// concerned: the answers it may show as already given.
//
// WHY A LOADER OF ITS OWN
// `listRegistrationApplications` (src/server/registration/supabase-store.ts:800)
// reads the whole `registrations` table and filters in TypeScript afterwards —
// fine for an admin console, wrong for a page that needs one artist's row, and it
// would put a full-table read on a public route. This reads the same table the way
// `submission-eligibility.ts` and `registration-for-contest.ts` already do: scoped
// to `user_id`, narrowed to the Open Mic slugs, and nothing more.
//
// IT NEVER FAILS THE PAGE
// Inheritance is a convenience, never a requirement: the submit endpoint re-derives
// eligibility from the database anyway. So every error path returns an empty list
// and the form asks all its questions, exactly as it did before this module
// existed. A broken read must not be able to lock an approved artist out of handing
// in their song.
import { createAdminClient } from '@/lib/supabase/server';
import { requireUser } from '@/src/lib/auth/server';
import { OPEN_MIC_CONTEST_SLUGS } from '@/src/features/openmic/constants';
import {
  EMPTY_INHERITANCE,
  resolveHandinInheritance,
  type HandinInheritance,
} from '@/src/features/openmic/handin-record';

/** Rows the pure resolver needs; a monthly edition's slug is not in the alias list. */
const SELECT = 'contest_slug, form_data, updated_at';
const PAGE_LIMIT = 25;

/**
 * The artist's Open Mic applications, newest first.
 *
 * The list is fetched rather than one row because the resolver, not the database,
 * decides which application counts (this edition's own slug, else the newest Open
 * Mic row) — and because a registration stores the catalog slug while the edition
 * the artist is looking at has its own.
 */
export async function readOpenMicApplications(
  userId: string,
  contestSlug: string,
): Promise<Parameters<typeof resolveHandinInheritance>[0]> {
  if (!userId) return [];
  const slugs = Array.from(new Set(
    [contestSlug, ...OPEN_MIC_CONTEST_SLUGS].filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim()),
  ));
  if (slugs.length === 0) return [];

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('registrations')
      .select(SELECT)
      .eq('user_id', userId)
      .in('contest_slug', slugs)
      .order('updated_at', { ascending: false })
      .limit(PAGE_LIMIT);
    if (error || !Array.isArray(data)) return [];
    return data
      .filter((row) => row && typeof row === 'object')
      .map((row) => ({
        contestSlug: String(row.contest_slug ?? ''),
        updatedAt: row.updated_at == null ? null : String(row.updated_at),
        formData: (row.form_data && typeof row.form_data === 'object')
          ? row.form_data as Record<string, unknown>
          : null,
      }));
  } catch {
    return [];
  }
}

/**
 * What this artist's own Open Mic application already answered, for the edition in
 * the URL. Nothing here is required by the hand-in endpoint beyond what the form
 * already collects: an empty answer simply leaves every question on screen.
 */
export async function getHandinInheritance(
  userId: string,
  contestSlug: string,
): Promise<HandinInheritance> {
  const applications = await readOpenMicApplications(userId, contestSlug);
  return resolveHandinInheritance(applications, contestSlug);
}

/**
 * The one call a hand-in page makes: this visitor's answers, plus the email they
 * signed up with (which no registration row stores, but the submission endpoint
 * matches on).
 *
 * Signed out, or if anything about the read fails, this returns an empty record and
 * the form asks every question — the same page an artist saw before inheritance
 * existed, which is the safe fallback rather than a locked field with no value.
 */
export async function readHandinRecord(
  contestSlug: string,
): Promise<{ inheritance: HandinInheritance; accountEmail: string }> {
  try {
    const { user } = await requireUser();
    const inheritance = await getHandinInheritance(user.id, contestSlug);
    return { inheritance, accountEmail: String(user.email ?? '').trim() };
  } catch {
    return { inheritance: EMPTY_INHERITANCE, accountEmail: '' };
  }
}
