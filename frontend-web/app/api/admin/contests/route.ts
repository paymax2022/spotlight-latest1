import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import type { ContestCategory, ContestRegistrationDefinition, ContestType } from '@/src/features/registration/types';
import { sanitizeContestFormSchema } from '@/src/features/registration/field-catalog';
import { createRegistrationContest, listRegistrationContests } from '@/src/server/registration/store';
import {
  contestSlugExists,
  listPersistedContests,
  persistContestDefinition,
} from '@/src/server/registration-v2/contest-store';
import { publishContestToVotingPlane } from '@/src/server/registration-v2/publish-to-voting';
import { createAdminClient } from '@/lib/supabase/server';

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

export async function GET() {
  try {
    // Postgres is the source of truth now, but the in-memory catalog still holds
    // the code-defined contests (and anything created before this route started
    // persisting), so both are listed. Postgres wins on slug collision.
    const persisted = await listPersistedContests();
    const seen = new Set(persisted.map((c) => c.slug));
    const legacy = listRegistrationContests().filter((c) => !seen.has(c.slug));
    return successResponse({ success: true, contests: [...persisted, ...legacy] });
  } catch (error) {
    return handleApiError(error, 'Failed to load admin contests');
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    const title = String(body?.title || '').trim();
    const slug = toSlug(String(body?.slug || title));
    const contestCategory = String(body?.contestCategory || '').trim() as ContestCategory;
    const contestType = String(body?.contestType || '').trim() as ContestType;
    const seasonOrEdition = String(body?.seasonOrEdition || '').trim();
    const regionScope = String(body?.regionScope || 'national').trim() as ContestRegistrationDefinition['regionScope'];

    if (!title) return errorResponse('Contest title is required.', 400);
    if (!slug) return errorResponse('Contest slug is required.', 400);
    if (!allowedCategories.includes(contestCategory)) return errorResponse('Invalid contest category.', 400);
    if (!allowedTypes.includes(contestType)) return errorResponse('Invalid contest type.', 400);
    if (!seasonOrEdition) return errorResponse('Season / edition is required.', 400);

    // Auditions are optional. When they are on, at least one state is required —
    // otherwise the contest schedules auditions nowhere. Mirrors the client check.
    const supportsAuditionScheduling = Boolean(body?.supportsAuditionScheduling);
    const auditionStates = Array.isArray(body?.auditionStates)
      ? body.auditionStates.map((item: unknown) => String(item)).filter(Boolean)
      : [];
    if (supportsAuditionScheduling && auditionStates.length === 0) {
      return errorResponse('Select at least one audition state, or turn auditions off.', 400);
    }

    const isPaid = Boolean(body?.isPaid);
    const registrationFeeNgn = isPaid ? Number(body?.registrationFeeNgn || 0) : 0;
    if (isPaid && (!Number.isFinite(registrationFeeNgn) || registrationFeeNgn < 0)) {
      return errorResponse('Registration fee must be a valid number for paid contests.', 400);
    }

    if (await contestSlugExists(slug)) {
      return errorResponse('A contest with that slug already exists.', 409);
    }

    const contest = createRegistrationContest({
      slug,
      title,
      contestCategory,
      contestType,
      seasonOrEdition,
      regionScope,
      isPaid,
      registrationFeeNgn,
      requiresGuardianConsentForMinors: Boolean(body?.requiresGuardianConsentForMinors),
      legalAdultAge: Number(body?.legalAdultAge || 18),
      requiresMedical: Boolean(body?.requiresMedical),
      requiresBootcampReadiness: Boolean(body?.requiresBootcampReadiness),
      supportsVoting: Boolean(body?.supportsVoting),
      supportsAuditionScheduling,
      supportsSchoolEntry: Boolean(body?.supportsSchoolEntry),
      supportsGroupEntry: Boolean(body?.supportsGroupEntry),
      // Cleared when auditions are off, so a disabled contest never stores states.
      auditionStates: supportsAuditionScheduling ? auditionStates : [],
      applicantCategories: Array.isArray(body?.applicantCategories)
        ? body.applicantCategories.map((item: unknown) => String(item)).filter(Boolean)
        : [],
      categoryQuestionSet: contestCategory,
      formSchema: sanitizeContestFormSchema(body?.formSchema),
    });

    // Write through to Postgres so the contest exists outside this process: the
    // web contest list, the Go voting API, and the mobile app all read the DB.
    // The in-memory write above is kept because the registration flow resolves a
    // contest by slug out of that catalog (store.ts is protected — see the
    // registration-v2 module header).
    const { id } = (await persistContestDefinition(contest)) ?? { id: undefined };

    // Publish votable contests into the voting plane so the mobile app can see
    // them. The registration definition and the votable contest are different
    // records; this is the seam between them.
    //
    // Best-effort by design: the contest IS saved at this point, and failing the
    // response here would tell an admin their contest was not created when it
    // was. The outcome is reported instead, so a failure is visible rather than
    // silent.
    const publish = await publishContestToVotingPlane(createAdminClient(), contest).catch(
      (err): Awaited<ReturnType<typeof publishContestToVotingPlane>> => {
        console.error('[admin/contests] publish to voting plane threw', err);
        return { published: false, reason: 'failed', detail: String(err) };
      },
    );

    return successResponse({ success: true, contest: { ...contest, id }, publish }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create contest');
  }
}
