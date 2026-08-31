// Durable contest definitions.
//
// `src/server/registration/store.ts` keeps contest definitions on globalThis,
// mirrored to a JSON file in os.tmpdir(). Its own comment says "until this moves
// to Supabase", and `supabase-store.ts` moved registrations across but left
// contests behind, re-exporting the in-memory pair. The consequence: a contest
// created in /admin/contests never reached Postgres, so nothing outside that one
// Next.js process — the web contest list, the Go voting API, the mobile app —
// could ever see it.
//
// This writes contest definitions to public.contests, which is the table the web
// `/api/v1/contests` endpoint serves and which 20261223000000 mirrors into
// connect_contests for the mobile voting plane.
//
// Additive by construction: store.ts is protected and is NOT modified. The admin
// route writes through BOTH, so the registration flow (which resolves a contest
// by slug out of the in-memory catalog) keeps working unchanged.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ContestRegistrationDefinition } from '@/src/features/registration/types';

// Lazy + memoized for the same reason as supabase-store: a module-level
// createClient() throws "supabaseUrl is required" at import time whenever env is
// unset (vitest collection, next build).
let supabaseClient: SupabaseClient | null = null;
function getSupabase() {
  if (!supabaseClient) {
    supabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || '',
      { auth: { persistSession: false } },
    );
  }
  return supabaseClient;
}

/** Slug -> human label for contests.category, which the web API returns verbatim. */
const CATEGORY_LABEL: Record<string, string> = {
  music: 'Music',
  acting: 'Acting',
  comedy_content: 'Comedy',
  dance: 'Dance',
  film_production: 'Film',
  stem_innovation: 'STEM',
  sme_pitch: 'SME Pitch',
  school_campus: 'School & Campus',
  open_mic: 'Open Mic',
  general_reality_show: 'Reality Show',
  other: 'Other',
};

export function categoryLabel(slug: string): string {
  return CATEGORY_LABEL[slug] ?? 'Other';
}

/**
 * Persist a contest definition to public.contests.
 *
 * status is 'active' so the contest is visible immediately — that is the point of
 * creating it, and it is what /api/v1/contests (status in active|upcoming) and the
 * connect_contests mirror (active -> open) surface. Visible is not votable:
 * voting_enabled follows the form's own supportsVoting toggle, so a contest shows
 * up in the list without accepting votes until voting is deliberately turned on.
 *
 * The full definition — form schema, applicant categories, audition states, the
 * capability flags — is kept verbatim in contest_config, because public.contests
 * has no columns for it and it must survive a round trip.
 */
export async function persistContestDefinition(
  def: ContestRegistrationDefinition,
): Promise<{ id: string } | null> {
  const { data, error } = await getSupabase()
    .from('contests')
    .insert({
      name: def.title,
      slug: def.slug,
      description: '',
      category: categoryLabel(def.contestCategory),
      // UPCOMING, not active — and not 'draft' either.
      //
      // 'active' was wrong: the contests -> connect_contests mirror maps it to
      // 'open', so a newly saved contest appeared on the phone as LIVE the moment
      // an admin hit save. Creating a contest and opening voting on it are
      // separate decisions.
      //
      // 'draft' replaced it and overcorrected: /api/v1/contests filters
      // status in (active, upcoming) and Go's ListContests filters (open, closed),
      // so a draft contest was invisible on BOTH planes — and nothing in the repo
      // could move it out of draft, which stranded every contest an admin created.
      //
      // 'upcoming' keeps both intents: the contest is visible on the web list
      // immediately, while the mirror maps upcoming -> draft so it stays off the
      // phone until an admin sets it active from the status control.
      status: 'upcoming',
      contest_type: def.contestType,
      location_scope: def.regionScope,
      entry_fee_ngn: def.isPaid ? Math.max(0, Math.round(def.registrationFeeNgn ?? 0)) : 0,
      season_name: def.seasonOrEdition,
      voting_enabled: def.supportsVoting,
      age_min: def.legalAdultAge,
      // publishContestToVotingPlane (called right after this, same request) was
      // meant to set these on first creation — but it does a slug lookup first,
      // finds the row THIS insert just created, and takes its "existing contest,
      // preserve admin-tuned values" branch instead, which deliberately excludes
      // these four fields. The two functions race to create the same row and
      // this one always wins, so publishContestToVotingPlane's insert-only
      // defaults never actually ran for any contest. Set here instead: without
      // max_votes_per_user, the connect_contests mirror trigger derives
      // free_votes_per_user as 0, and a "votable" contest with zero free votes
      // and no paid price is unvotable — it shows up on mobile but nobody can
      // vote on it.
      max_votes_per_user: def.supportsVoting ? 1 : 0,
      voting_type: 'free',
      vote_price_ngn: 0,
      vote_price: 0,
      rules_text: def.rulesText?.trim() || '',
      banner_image_url: def.bannerImageUrl?.trim() || '',
      contest_config: def as unknown as Record<string, unknown>,
    })
    .select('id')
    .single();

  if (error) {
    // Surfaced by the caller; never swallowed into a false success.
    throw new Error(`Failed to persist contest to Postgres: ${error.message}`);
  }
  return data ? { id: data.id as string } : null;
}

/**
 * Update a persisted contest definition in-place (by its current slug).
 *
 * Mirrors persistContestDefinition's column mapping so the two never drift
 * apart. Thrown, not swallowed, on a missing row or a Postgres error — same
 * contract as persistContestDefinition.
 */
export async function updateContestDefinition(
  currentSlug: string,
  def: ContestRegistrationDefinition,
): Promise<void> {
  const { error, count } = await getSupabase()
    .from('contests')
    .update({
      name: def.title,
      slug: def.slug,
      category: categoryLabel(def.contestCategory),
      contest_type: def.contestType,
      location_scope: def.regionScope,
      entry_fee_ngn: def.isPaid ? Math.max(0, Math.round(def.registrationFeeNgn ?? 0)) : 0,
      season_name: def.seasonOrEdition,
      voting_enabled: def.supportsVoting,
      age_min: def.legalAdultAge,
      rules_text: def.rulesText?.trim() || '',
      banner_image_url: def.bannerImageUrl?.trim() || '',
      contest_config: def as unknown as Record<string, unknown>,
    }, { count: 'exact' })
    .eq('slug', currentSlug);

  if (error) throw new Error(`Failed to update contest in Postgres: ${error.message}`);
  if (!count) throw new Error('Contest not found.');
}

/** Delete a persisted contest definition by slug. Throws if the row doesn't exist. */
export async function deleteContestDefinition(slug: string): Promise<void> {
  const { error, count } = await getSupabase()
    .from('contests')
    .delete({ count: 'exact' })
    .eq('slug', slug);

  if (error) throw new Error(`Failed to delete contest from Postgres: ${error.message}`);
  if (!count) throw new Error('Contest not found.');
}

/** Is a slug already taken in Postgres? contests.slug carries no UNIQUE index. */
export async function contestSlugExists(slug: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from('contests')
    .select('id')
    .eq('slug', slug)
    .limit(1);
  if (error) throw new Error(`Failed to check contest slug: ${error.message}`);
  return Boolean(data && data.length > 0);
}

/** One persisted contest by slug, or null. */
export async function getPersistedContestBySlug(slug: string): Promise<PersistedContest | null> {
  const all = await listPersistedContests();
  return all.find((c) => c.slug === slug) ?? null;
}

/**
 * One persisted contest by its public.contests.id — the id the voting plane
 * (mobile's contest-details screen, Go's /api/v1/connect/contests) actually
 * carries. Registration's own catalog is keyed on slug, which a real contest
 * never exposed to that screen; resolving by id is what lets "Apply to
 * Compete" on a real contest reach the actual contest instead of a title
 * guess against unrelated registration templates.
 */
export async function getPersistedContestById(id: string): Promise<PersistedContest | null> {
  const all = await listPersistedContests();
  return all.find((c) => c.id === id) ?? null;
}

/**
 * Contest definitions held in Postgres, newest first. Rows written before this
 * module existed have no contest_config, so a definition is reconstructed from
 * the columns rather than dropped from the list.
 */
export type PersistedContest = ContestRegistrationDefinition & {
  /** public.contests.id — the key every per-contest admin route is addressed by. */
  id?: string;
  /** public.contests.status — drives visibility on the web and mobile planes. */
  status?: ContestStatus;
};

/** The public.contests.status enum, in publication order. */
export const CONTEST_STATUSES = ['draft', 'upcoming', 'active', 'ended'] as const;
export type ContestStatus = (typeof CONTEST_STATUSES)[number];

export function isContestStatus(value: unknown): value is ContestStatus {
  return typeof value === 'string' && (CONTEST_STATUSES as readonly string[]).includes(value);
}

export async function listPersistedContests(): Promise<PersistedContest[]> {
  const { data, error } = await getSupabase()
    .from('contests')
    .select('id, slug, name, status, category, contest_type, location_scope, entry_fee_ngn, season_name, voting_enabled, rules_text, banner_image_url, contest_config, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to list contests: ${error.message}`);

  return (data ?? []).map((row) => {
    const id = row.id as string | undefined;
    const status = (isContestStatus(row.status) ? row.status : undefined) as ContestStatus | undefined;
    const cfg = (row.contest_config ?? null) as ContestRegistrationDefinition | null;
    // The id lives on the row, never in contest_config — carry it onto the
    // definition so the admin table can link to per-contest routes.
    if (cfg && typeof cfg === 'object' && cfg.slug) return { ...cfg, id, status };
    return {
      id,
      status,
      slug: String(row.slug ?? ''),
      title: String(row.name ?? ''),
      contestCategory: 'other',
      contestType: String(row.contest_type ?? 'online_contest'),
      seasonOrEdition: String(row.season_name ?? ''),
      regionScope: (row.location_scope ?? 'national'),
      isPaid: Number(row.entry_fee_ngn ?? 0) > 0,
      registrationFeeNgn: Number(row.entry_fee_ngn ?? 0),
      requiresGuardianConsentForMinors: false,
      legalAdultAge: 18,
      requiresMedical: false,
      requiresBootcampReadiness: false,
      supportsVoting: Boolean(row.voting_enabled),
      supportsAuditionScheduling: false,
      supportsSchoolEntry: false,
      supportsGroupEntry: false,
      categoryQuestionSet: 'other',
      rulesText: String(row.rules_text ?? ''),
      bannerImageUrl: String(row.banner_image_url ?? ''),
    } as PersistedContest;
  }).filter((c) => c.slug);
}
