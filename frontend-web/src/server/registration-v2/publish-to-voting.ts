// Publish an admin-created registration contest into the voting plane.
//
// THE THREE PLANES
//   contest_registration_contests  what /admin/contests persists (registration
//                                  definition: form schema, fees, consent rules)
//   contests                       the contest the web app and admin voting
//                                  console operate on
//   connect_contests               what the MOBILE app reads, via Go
//                                  GET /api/v1/connect/contests
//
// The second hop already exists: 20261223000000_connect_contests_bridge.sql
// mirrors contests -> connect_contests on a trigger, preserving the id. So this
// module only has to write the FIRST hop. Writing to `contests` is enough for a
// contest to reach the phone.
//
// Nothing here edits a protected legacy file. The contests/voting module is
// wrapped, not modified, per CLAUDE.md and the vote-bridge skill.
import type {
  ContestRegistrationDefinition,
  ContestType,
} from '@/src/features/registration/types';
import { createAdminClient } from '@/lib/supabase/server';

type Db = ReturnType<typeof createAdminClient>;

/**
 * Only these carry audience voting as the mechanic. An audition, a pitch
 * competition or a school contest has entrants but no public vote, and
 * publishing one would put it in front of voters with nothing to vote on.
 */
const VOTABLE_TYPES = new Set<ContestType>([
  'public_voting_contest',
  'bootcamp_reality_show',
  'housemate_reality_show',
]);

/**
 * A contest typed as votable but explicitly flagged `supportsVoting: false` is
 * contradictory data. The admin's explicit flag wins — refusing to publish is
 * recoverable, publishing something they switched off is not.
 */
export function isVotableContest(def: ContestRegistrationDefinition): boolean {
  return VOTABLE_TYPES.has(def.contestType) && def.supportsVoting !== false;
}

export type PublishOutcome =
  | { published: true; contestId: string; created: boolean }
  | { published: false; reason: 'not_votable' | 'invalid_title' | 'failed'; detail?: string };

/**
 * Free votes granted per user when a contest is published.
 *
 * The mirror trigger derives connect_contests.free_votes_per_user from
 * contests.max_votes_per_user via GREATEST(COALESCE(x, 0), 0). Leaving it NULL
 * would therefore publish a contest with ZERO free votes — and with paid voting
 * off, nobody could vote at all. One free vote matches connect_contests' own
 * column default.
 */
const DEFAULT_FREE_VOTES_PER_USER = 1;

export async function publishContestToVotingPlane(
  supabase: Db,
  def: ContestRegistrationDefinition,
): Promise<PublishOutcome> {
  if (!isVotableContest(def)) return { published: false, reason: 'not_votable' };

  // connect_contests.title has a 2..200 CHECK. The mirror trigger silently skips
  // a row it cannot represent, which would leave a contest that looks published
  // but never reaches the phone — so it is rejected here, where it can be said.
  const name = (def.title ?? '').trim();
  if (name.length < 2) {
    return { published: false, reason: 'invalid_title', detail: 'Title must be at least 2 characters' };
  }

  const payload = {
    name: name.slice(0, 200),
    slug: def.slug,
    category: def.contestCategory,
    contest_type: def.contestType,
    description: def.seasonOrEdition ? `${def.title} — ${def.seasonOrEdition}` : def.title,
    // UPCOMING, never live. Creating a contest and opening voting on it are
    // different decisions, so this must not publish straight to 'active' — the
    // mirror maps upcoming -> draft, keeping it off the phone until an admin sets
    // it active. 'draft' was too strict: it also hides the contest from the WEB
    // list (/api/v1/contests filters active|upcoming), which stranded contests
    // with no way back. Only ever applies on insert; see the update branch below.
    status: 'upcoming' as const,
    voting_enabled: true,
    // Paid voting OFF. A vote price is a commercial decision an admin makes
    // explicitly; inventing one here would put a price in front of voters that
    // nobody set.
    voting_type: 'free',
    vote_price_ngn: 0,
    vote_price: 0,
    max_votes_per_user: DEFAULT_FREE_VOTES_PER_USER,
  };

  // Keyed on slug, which carries a unique index. Select-then-write rather than
  // ON CONFLICT because that index is PARTIAL, and an inferred conflict target
  // must restate the predicate exactly or Postgres rejects it.
  const { data: existing, error: findErr } = await supabase
    .from('contests')
    .select('id')
    .eq('slug', def.slug)
    .maybeSingle();

  if (findErr) {
    console.error('[publish-to-voting] slug lookup failed', { slug: def.slug, error: findErr.message });
    return { published: false, reason: 'failed', detail: findErr.message };
  }

  if (existing) {
    const id = (existing as { id: string }).id;
    // Deliberately does NOT overwrite `status`: an admin who opened voting must
    // not have it forced back to draft by an unrelated edit to the registration
    // form. Republishing updates the description, never the live state.
    const { status: _ignored, ...safeUpdate } = payload;
    const { error } = await supabase.from('contests').update(safeUpdate).eq('id', id);
    if (error) {
      console.error('[publish-to-voting] update failed', { slug: def.slug, error: error.message });
      return { published: false, reason: 'failed', detail: error.message };
    }
    return { published: true, contestId: id, created: false };
  }

  const { data, error } = await supabase.from('contests').insert(payload).select('id').single();
  if (error || !data) {
    console.error('[publish-to-voting] insert failed', { slug: def.slug, error: error?.message });
    return { published: false, reason: 'failed', detail: error?.message };
  }
  return { published: true, contestId: (data as { id: string }).id, created: true };
}
