import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
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

const allowedCategories: ContestCategory[] = [
  'music',
  'acting',
  'comedy_content',
  'dance',
  'film_production',
  'stem_innovation',
  'sme_pitch',
  'school_campus',
  'open_mic',
  'general_reality_show',
  'other',
];

const allowedTypes: ContestType[] = [
  'online_contest',
  'physical_audition',
  'hybrid_contest',
  'public_voting_contest',
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

function normalizeContestPayload(body: Record<string, unknown>): Partial<ContestRegistrationDefinition> {
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
  if (!allowedTypes.includes(contestType)) throw new Error('Invalid contest type.');
  if (!seasonOrEdition) throw new Error('Season / edition is required.');
  if (isPaid && (!Number.isFinite(registrationFeeNgn) || registrationFeeNgn < 0)) {
    throw new Error('Registration fee must be a valid number for paid contests.');
  }

  const normalized: Partial<ContestRegistrationDefinition> = {
    slug,
    title,
    contestCategory,
    contestType,
    seasonOrEdition,
    regionScope,
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
  };

  // Only touch the form schema when the caller actually sends one, so a partial
  // edit that omits `formSchema` preserves the existing mapping instead of
  // wiping it. Sending an explicit (empty/invalid) schema clears it.
  if ('formSchema' in body) {
    normalized.formSchema = sanitizeContestFormSchema(body.formSchema);
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
    const patch = normalizeContestPayload(body);

    let memoryResult: ContestRegistrationDefinition | null = null;
    try {
      memoryResult = updateRegistrationContest(params.slug, patch);
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('not found')) throw err;
    }

    // The Postgres row needs a complete definition, not a partial patch — the
    // memory update above already merged the patch onto the prior record when
    // that record existed there; otherwise fall back to whatever Postgres has.
    const base = memoryResult ?? (await getPersistedContestBySlug(params.slug));
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
    const message = error instanceof Error ? error.message : '';
    if (message.includes('required') || message.includes('Invalid') || message.includes('valid')) {
      return errorResponse(message, 400);
    }
    if (message.includes('already exists')) return errorResponse(message, 409);
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
