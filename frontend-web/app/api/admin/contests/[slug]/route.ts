import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { allowedCategorySlugs } from '@/src/server/contests/categories';
import {
  deleteRegistrationContest,
  getRegistrationContestBySlug,
  updateRegistrationContest,
} from '@/src/server/registration/store';
import {
  deleteContestDefinition,
  getPersistedContestBySlug,
  persistContestDefinition,
  updateContestDefinition,
} from '@/src/server/registration-v2/contest-store';
import type { ContestCategory, ContestRegistrationDefinition, ContestType } from '@/src/features/registration/types';
import { sanitizeContestFormSchema } from '@/src/features/registration/field-catalog';
import { contestScheduleError, readContestSchedule } from '@/src/server/contests/schedule';
import { contestLocalityFor, isContestLocalityError } from '@/src/server/registration-v2/contest-locality';

const allowedTypes: ContestType[] = [
  'online_contest',
  'physical_audition',
  'hybrid_contest',
  'public_voting_contest',
  'one_beat_one_verse',
  'bootcamp_reality_show',
  'housemate_reality_show',
  'pitch_competition',
  'school_vs_school_contest',
  'regional_contest',
  'national_contest',
  'international_entry',
];

function toSlug(raw: string) {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Is this contest type writable on this contest?
 *
 * public.contests.contest_type is a plain TEXT column shared by two vocabularies.
 * `allowedTypes` is the registration catalog. The unified contest engine writes
 * its own values into the same column: the DEFAULT is 'general'
 * (20260410190000_one_beat_one_verse_foundation.sql:9, re-added by
 * 20260412153000_contests_schema_compat_repair.sql:11, whose :65 CASE files the
 * pre-existing categories under 'multi_skill'), 20260507113000 consolidates to
 * 'reality_tv_show', the STEM plane writes 'STEM'
 * (src/server/stem/persistence.ts:432), and
 * backend/internal/repositories/competition_supabase_repository.go:42-49 counts
 * 'reality_tv_show', 'one_beat_one_verse' and 'multi_skill' for the admin
 * overview. On the local dev database only 1 row in 160 holds a catalog type.
 *
 * A PATCH carries the whole definition, and the read path hands back the stored
 * value verbatim (listPersistedContests has to — normalising it there would
 * rewrite the engine's type and the overview counts on the next save). So an edit
 * that never touched the Type field sent a catalog-invalid value straight back,
 * and the contest could not be saved at all: every banner, prize or deadline edit
 * on such a row answered 'Invalid contest type.'.
 *
 * So the value already on THIS row is accepted, because rejecting it asks the
 * admin to change a field they did not change and silently move the contest onto
 * a different engine. It is deliberately not a second allow-list: 'multi_skill'
 * stored on one contest does not license writing it onto another, and anything
 * the admin actually picks from the dropdown is still checked against the catalog.
 */
function isContestTypeAllowed(value: string, storedType?: string): boolean {
  if (allowedTypes.includes(value as ContestType)) return true;
  const tolerated = (storedType ?? '').trim();
  return tolerated.length > 0 && value === tolerated;
}

// allowedCategories is passed in rather than read here so this stays a pure
// sync normalizer; the DB read happens once in the handler.
//
// storedType is the contest_type this very row already carries, and it is the
// one exception to the catalog: see isContestTypeAllowed.
function normalizeContestPayload(
  body: Record<string, unknown>,
  allowedCategories: string[],
  storedType?: string,
): Partial<ContestRegistrationDefinition> {
  const title = String(body.title || '').trim();
  const slug = toSlug(String(body.slug || title));
  const contestCategory = String(body.contestCategory || '').trim() as ContestCategory;
  const contestType = String(body.contestType || '').trim() as ContestType;
  const seasonOrEdition = String(body.seasonOrEdition || '').trim();
  const regionScope = String(body.regionScope || 'national').trim() as ContestRegistrationDefinition['regionScope'];
  const isPaid = Boolean(body.isPaid);
  const registrationFeeNgn = isPaid ? Number(body.registrationFeeNgn || 0) : 0;

  if (!title) throw new Error('Contest title is required.');
  if (!slug) throw new Error('Contest slug is required.');
  if (!allowedCategories.includes(contestCategory)) throw new Error('Invalid contest category.');
  if (!isContestTypeAllowed(contestType, storedType)) throw new Error('Invalid contest type.');
  if (!seasonOrEdition) throw new Error('Season / edition is required.');
  if (isPaid && (!Number.isFinite(registrationFeeNgn) || registrationFeeNgn < 0)) {
    throw new Error('Registration fee must be a valid number for paid contests.');
  }

  // Locality follows the scope, exactly as it does on POST: a local contest has
  // to name its state and LGA, and a scope that is no longer local clears the
  // triple rather than leaving a stale claim on the row.
  const locality = contestLocalityFor(regionScope, body);
  if (!locality.ok) throw new Error(locality.error);

  const normalized: Partial<ContestRegistrationDefinition> = {
    slug,
    title,
    contestCategory,
    contestType,
    seasonOrEdition,
    regionScope,
    ...locality.locality,
    isPaid,
    registrationFeeNgn,
    requiresGuardianConsentForMinors: Boolean(body.requiresGuardianConsentForMinors),
    legalAdultAge: Number(body.legalAdultAge || 18),
    requiresMedical: Boolean(body.requiresMedical),
    requiresBootcampReadiness: Boolean(body.requiresBootcampReadiness),
    supportsVoting: Boolean(body.supportsVoting),
    supportsAuditionScheduling: Boolean(body.supportsAuditionScheduling),
    supportsSchoolEntry: Boolean(body.supportsSchoolEntry),
    supportsGroupEntry: Boolean(body.supportsGroupEntry),
    auditionStates: Array.isArray(body.auditionStates)
      ? body.auditionStates.map((item) => String(item)).filter(Boolean)
      : [],
    applicantCategories: Array.isArray(body.applicantCategories)
      ? body.applicantCategories.map((item) => String(item)).filter(Boolean)
      : [],
    categoryQuestionSet: contestCategory,
    rulesText: String(body.rulesText || '').trim(),
    bannerImageUrl: String(body.bannerImageUrl || '').trim(),
    logoUrl: String(body.logoUrl || '').trim(),
  };

  // Only touch the form schema when the caller actually sends one, so a partial
  // edit that omits `formSchema` preserves the existing mapping instead of
  // wiping it. Sending an explicit (empty/invalid) schema clears it.
  if ('formSchema' in body) {
    normalized.formSchema = sanitizeContestFormSchema(body.formSchema);
  }

  // Same present-vs-absent rule as formSchema, for the same reason: an edit that
  // never mentions the schedule must not null out a deadline an admin set. An
  // empty field IS a mention, and clears it. The dates land here as instants —
  // src/server/contests/schedule.ts expands a bare day to the day's last
  // instant, and contest-store.ts writes them onto start_date/end_date, which
  // 20261223000000 mirrors into the mobile voting window.
  const schedule = readContestSchedule(body);
  if (schedule) {
    const scheduleProblem = contestScheduleError(schedule);
    if (scheduleProblem) throw new Error(scheduleProblem);
    normalized.startDate = schedule.startDate ?? '';
    normalized.endDate = schedule.endDate ?? '';
    normalized.prizePool = schedule.prizePool;
  }

  return normalized;
}

// GET/PATCH/DELETE used to read/write ONLY the in-memory catalog
// (registration/store.ts) — a globalThis Map, gone on restart. Meanwhile the
// sibling collection route's POST already writes through to Postgres
// (registration-v2/contest-store.ts, see its own header). The result: editing
// or deleting a contest here appeared to succeed but never touched Postgres,
// so the change was silently lost the moment the process restarted, and a
// contest that only exists in Postgres (created before this process booted)
// 404'd here even though the public list showed it. Postgres is now checked
// first for GET, and PATCH/DELETE write through to both stores the same way
// POST does — tolerating "not found" in either individual store so a
// contest that only ever reached one side (e.g. a pre-existing catalog seed
// never persisted) still edits/deletes cleanly.

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const params = await ctx.params;
  try {
    await assertAdminPermission(request, 'programs:manage');
    const contest = (await getPersistedContestBySlug(params.slug)) ?? getRegistrationContestBySlug(params.slug);
    if (!contest) return errorResponse('Contest not found', 404);
    return successResponse({ success: true, contest });
  } catch (error) {
    return handleApiError(error, 'Failed to load contest');
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const params = await ctx.params;
  try {
    await assertAdminPermission(request, 'programs:manage');
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    // What this contest is right now, same precedence as GET above (Postgres
    // first, the legacy catalog as fallback). Read before validating, because a
    // field the caller did not change is judged against the row itself rather
    // than against the catalog alone — see isContestTypeAllowed. It is also the
    // definition a Postgres-only PATCH merges onto, so this costs no extra read.
    const stored =
      (await getPersistedContestBySlug(params.slug)) ?? getRegistrationContestBySlug(params.slug);
    const patch = normalizeContestPayload(body, await allowedCategorySlugs(), stored?.contestType);

    let memoryResult: ContestRegistrationDefinition | null = null;
    try {
      memoryResult = updateRegistrationContest(params.slug, patch);
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('not found')) throw err;
    }

    // The Postgres row needs a complete definition, not a partial patch — the
    // memory update above already merged the patch onto the prior record when
    // that record existed there; otherwise fall back to whatever Postgres has.
    const base = memoryResult ?? stored;
    if (!base) return errorResponse('Contest not found', 404);
    const full: ContestRegistrationDefinition = { ...base, ...patch } as ContestRegistrationDefinition;

    let postgresOk = true;
    try {
      await updateContestDefinition(params.slug, full);
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) postgresOk = false;
      else throw err;
    }

    // A contest edited here for the first time may exist only in the legacy
    // catalog (created before this route wrote through to Postgres, or before
    // updateContestDefinition existed). Rather than silently keep the edit
    // memory-only — the exact bug this route was fixed for — persist it now.
    if (!postgresOk) await persistContestDefinition(full);

    if (!memoryResult && !postgresOk) return errorResponse('Contest not found', 404);
    return successResponse({ success: true, contest: full });
  } catch (error) {
    // Exact-match the domain errors normalizeContestPayload and
    // updateRegistrationContest deliberately throw — a substring match here
    // (e.g. includes('valid')) used to catch PostgREST's "invalid input
    // syntax for type …" and echo the raw Postgres message to the client.
    const message = error instanceof Error ? error.message : '';
    if (
      message === 'Contest title is required.' ||
      message === 'Contest slug is required.' ||
      message === 'Invalid contest category.' ||
      message === 'Invalid contest type.' ||
      message === 'Season / edition is required.' ||
      message === 'Registration fee must be a valid number for paid contests.' ||
      message === 'Contest start date is not a valid date.' ||
      message === 'Contest end date is not a valid date.' ||
      message === 'The contest end date must be on or after the start date.'
    ) {
      return errorResponse(message, 400);
    }
    if (
      message === 'A contest with this slug already exists.' ||
      message === 'A contest with this title already exists.'
    ) {
      return errorResponse(message, 409);
    }
    // The locality errors carry the exact sentence the admin needs (which level
    // is missing), so they pass through verbatim rather than being flattened
    // into the generic 500. POST answers the same mistake with
    // errorResponse(locality.error, 400).
    if (isContestLocalityError(message)) return errorResponse(message, 400);
    return handleApiError(error, 'Failed to update contest');
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const params = await ctx.params;
  try {
    await assertAdminPermission(request, 'programs:manage');

    let memoryOk = true;
    try {
      deleteRegistrationContest(params.slug);
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) memoryOk = false;
      else throw err;
    }

    let postgresOk = true;
    try {
      await deleteContestDefinition(params.slug);
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) postgresOk = false;
      else throw err;
    }

    if (!memoryOk && !postgresOk) return errorResponse('Contest not found', 404);
    return successResponse({ success: true });
  } catch (error) {
    return handleApiError(error, 'Failed to delete contest');
  }
}
