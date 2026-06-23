import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import type { ContestCategory, ContestRegistrationDefinition, ContestType } from '@/src/features/registration/types';
import { createRegistrationContest, listRegistrationContests } from '@/src/server/registration/store';

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
    const contests = listRegistrationContests();
    return successResponse({ success: true, contests });
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

    const isPaid = Boolean(body?.isPaid);
    const registrationFeeNgn = isPaid ? Number(body?.registrationFeeNgn || 0) : 0;
    if (isPaid && (!Number.isFinite(registrationFeeNgn) || registrationFeeNgn < 0)) {
      return errorResponse('Registration fee must be a valid number for paid contests.', 400);
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
      supportsAuditionScheduling: Boolean(body?.supportsAuditionScheduling),
      supportsSchoolEntry: Boolean(body?.supportsSchoolEntry),
      supportsGroupEntry: Boolean(body?.supportsGroupEntry),
      auditionStates: Array.isArray(body?.auditionStates)
        ? body.auditionStates.map((item: unknown) => String(item)).filter(Boolean)
        : [],
      applicantCategories: Array.isArray(body?.applicantCategories)
        ? body.applicantCategories.map((item: unknown) => String(item)).filter(Boolean)
        : [],
      categoryQuestionSet: contestCategory,
    });

    return successResponse({ success: true, contest }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create contest');
  }
}
