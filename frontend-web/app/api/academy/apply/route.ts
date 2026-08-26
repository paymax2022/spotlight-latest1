// Film Academy public application endpoint.
// Accepts the application form + payment_preference, stores both.

import { ApiError, errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser, type RequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getBatchAreaSlugs } from '@/src/server/services/academy/batchAreas';
import { getOrCreateUserProfile } from '@/src/server/user/profile';
import { verifyPaystackTransaction } from '@/src/lib/payments/paystack';

type AcademyBatchRow = {
  id: string;
  batch_name: string;
  start_date: string | null;
  training_schedule: string | null;
  duration_weeks: number | null;
  status: string | null;
  training_fee_ngn: number | null;
  one_off_discount_pct: number | null;
  installments_count: number | null;
  fee_frequency: string | null;
  description: string | null;
};

const LEGACY_TALENT_CATEGORY_MAP: Record<string, string> = {
  acting: 'acting',
  script_writing: 'other',
  film_directing: 'film_production',
  cinematography: 'film_production',
  video_editing: 'film_production',
  sound_design: 'music_production',
  production_management: 'film_production',
};

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getOptionalString(value: unknown) {
  const text = getString(value);
  return text || null;
}

function getStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function deriveTalentCategory(areasOfInterest: string[]) {
  for (const area of areasOfInterest) {
    const mapped = LEGACY_TALENT_CATEGORY_MAP[area];
    if (mapped) return mapped;
  }

  return 'other';
}

function isSchemaMismatchError(
  error: { code?: string; message?: string; details?: string | null } | null,
) {
  if (!error) return false;

  const text = `${error.code || ''} ${error.message || ''} ${error.details || ''}`.toLowerCase();
  return (
    text.includes('column') ||
    text.includes('schema cache') ||
    text.includes('could not find') ||
    text.includes('pgrst204') ||
    text.includes('42703')
  );
}

function isDuplicateApplicationError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const text = `${error.code || ''} ${error.message || ''}`.toLowerCase();
  return text.includes('23505') || text.includes('already applied');
}

/**
 * The applicant's identity as the PLATFORM already knows it.
 *
 * The account is the source of truth for these three fields — the user gave
 * them at sign-up, so the application form must not ask for them again. The
 * email in particular is taken from the authenticated session and NOT from the
 * request body: it keys the duplicate-application check, so accepting a
 * client-supplied address would let one account file under another's email.
 */
async function getApplicantIdentity(user: RequestUser) {
  // Optional chaining throughout: a profile row that is missing, partial, or
  // from an older schema must degrade to "the account knows nothing", which
  // makes the form ask — it must never fail the application with a 500.
  const profile = (await getOrCreateUserProfile(user)) as
    | Awaited<ReturnType<typeof getOrCreateUserProfile>>
    | undefined;
  const email = (user.email || profile?.email || '').trim();
  const composed = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim();
  // normalizeProfile folds user_profiles.full_name into displayName.
  const fullName = composed || (profile?.displayName || '').trim();

  return {
    // Sign-up stores the email as the display name when no name was given.
    // That is not a name — treat it as missing so the form can ask for one,
    // rather than filing "you@example.com" as the applicant.
    fullName: fullName && fullName.toLowerCase() !== email.toLowerCase() ? fullName : '',
    email,
    phone: (profile?.phone || '').trim(),
    // Also already on file. Unlike the three above these stay editable on the
    // form — they are per-application details a user may reasonably restate —
    // but there is no reason to make them start empty.
    gender: (profile?.gender || '').trim(),
    dateOfBirth: (profile?.dateOfBirth || '').trim(),
    state: (profile?.state || '').trim(),
    city: (profile?.city || '').trim(),
    country: (profile?.country || '').trim(),
    profile,
  };
}

/**
 * Backfills the account with details the applicant had to type because the
 * profile was missing them, so the NEXT module does not ask again. Only ever
 * fills blanks — it never overwrites what the user already set, and a failure
 * (older schema without these columns) must not fail the application.
 */
async function backfillProfileDetails(
  userId: string,
  current: { fullName: string; phone: string },
  supplied: { fullName: string; phone: string },
) {
  const patch: Record<string, string> = {};
  if (!current.fullName && supplied.fullName) patch.full_name = supplied.fullName;
  if (!current.phone && supplied.phone) patch.phone = supplied.phone;
  if (Object.keys(patch).length === 0) return;

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from('user_profiles').update(patch).eq('id', userId);
    if (error) console.warn('[academy] profile backfill skipped:', error.message);
  } catch (error) {
    console.warn('[academy] profile backfill skipped:', error);
  }
}

async function getActiveAcademySettings() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('academy_settings')
    .select('registration_type, application_fee, application_fee_refundable, tuition_fee')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return {
    registration_type: (data?.registration_type ?? 'free') as 'free' | 'paid',
    application_fee: Number(data?.application_fee ?? 0),
    application_fee_refundable: data?.application_fee_refundable === true,
    tuition_fee: Number(data?.tuition_fee ?? 0),
  };
}

async function findExistingBatchApplication(input: {
  userId: string;
  email: string;
  batchId: string;
}) {
  const supabase = createAdminClient();
  const select = 'id, status, payment_status, created_at';

  const { data: byUser, error: byUserError } = await supabase
    .from('academy_applications')
    .select(select)
    .eq('batch_id', input.batchId)
    .eq('user_id', input.userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byUserError) throw byUserError;
  if (byUser) return byUser;

  if (!input.email) return null;

  const { data: byEmail, error: byEmailError } = await supabase
    .from('academy_applications')
    .select(select)
    .eq('batch_id', input.batchId)
    .ilike('email', input.email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byEmailError) throw byEmailError;
  return byEmail;
}

async function getOptionalRequestUser(request: Request) {
  try {
    return await requireRequestUser(request);
  } catch {
    return null;
  }
}

/**
 * How many priced areas one application may carry, per batch.
 *
 * Enforced on the SERVER because the cap is a commercial rule, not a UI nicety:
 * the mobile form stops at this number, but the form is not what decides. An
 * application that slipped past it would be charged for every area it named.
 *
 * Applied to the DEDUPLICATED list — see the duplicate check below.
 *
 * Existing applications that already exceed it are deliberately left alone; the
 * cap governs new and edited submissions only.
 */
const MAX_INTEREST_AREAS_PER_APPLICATION = 2;

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    const supabase = createAdminClient();

    const paymentPreference = body.payment_preference === 'one_off' ? 'one_off' : 'installment';
    const batchId = getString(body.batch_id);

    // Identity comes from the ACCOUNT first. The form only sends these when the
    // profile has no value for them, so a signed-in applicant is never asked to
    // retype what they gave at sign-up.
    const identity = await getApplicantIdentity(user);
    const fullName = identity.fullName || getString(body.full_name);
    // Session-derived, never client-supplied — see getApplicantIdentity.
    const email = identity.email || getString(body.email);
    const phone = identity.phone || getString(body.phone);
    const areasOfInterest = getStringArray(body.areas_of_interest);
    const motivation = getString(body.motivation);
    const experience = getString(body.experience);
    const now = new Date().toISOString();
    const settings = await getActiveAcademySettings();
    if (!fullName) return errorResponse('Full name is required', 400);
    if (!email) return errorResponse('Email is required', 400);
    if (!phone) return errorResponse('Phone number is required', 400);
    if (!batchId) return errorResponse('Batch selection is required', 400);
    if (areasOfInterest.length === 0) {
      return errorResponse('At least one area of interest is required', 400);
    }
    // Duplicates are collapsed BEFORE the cap is applied. Counting the raw list
    // would let ['acting','acting','acting'] read as three selections, and — worse
    // — would price the same area three times in the tuition sum below.
    if (new Set(areasOfInterest).size !== areasOfInterest.length) {
      return errorResponse('The same area of interest was selected more than once', 400);
    }
    if (areasOfInterest.length > MAX_INTEREST_AREAS_PER_APPLICATION) {
      return errorResponse(
        `Choose at most ${MAX_INTEREST_AREAS_PER_APPLICATION} areas of interest for this batch`,
        400,
      );
    }
    if (!motivation) return errorResponse('Motivation is required', 400);

    // The fee is the BASE application fee plus the fee of every area the
    // applicant selected. Computed HERE from the admin-managed rows: the client
    // renders a running total for the user's benefit, but it could claim any
    // number, so nothing it sends is used in this sum.
    const { data: areaRows, error: areaError } = await supabase
      .from('academy_interest_areas')
      .select('slug, fee_ngn, is_active')
      .in('slug', areasOfInterest);
    if (areaError) throw areaError;

    const activeAreas = (areaRows ?? []).filter(
      (a) => (a as { is_active: boolean }).is_active,
    );

    // An unknown or retired slug must not silently price at zero — that would
    // let a crafted request buy a cheaper application. Reject it instead.
    if (activeAreas.length !== areasOfInterest.length) {
      const known = new Set(activeAreas.map((a) => String((a as { slug: string }).slug)));
      const bad = areasOfInterest.filter((a) => !known.has(a));
      return errorResponse(`Unknown area of interest: ${bad.join(', ')}`, 400);
    }

    // A batch may offer only a subset. Selecting one it does not offer is
    // rejected here rather than quietly charged — the client filters the list,
    // but the client is not what decides.
    const offered = await getBatchAreaSlugs(supabase, batchId);
    if (offered.length > 0) {
      const notOffered = areasOfInterest.filter((a) => !offered.includes(a));
      if (notOffered.length > 0) {
        return errorResponse(
          `This batch does not offer: ${notOffered.join(', ')}`,
          400,
        );
      }
    }

    // TUITION, not an application fee. academy_interest_areas.fee_ngn is the
    // cost of TAKING that area — payable on acceptance and refundable. It is
    // recorded against the application for later billing and is deliberately
    // NOT part of what is charged now.
    //
    // This was previously added to the amount collected at submit, which would
    // have taken ~₦255,000 up front, non-refundably, for a Film Directing
    // application nobody had reviewed yet.
    const tuitionTotal = activeAreas.reduce(
      (sum, a) => sum + Number((a as { fee_ngn: number | null }).fee_ngn ?? 0),
      0,
    );

    // The only thing payable at APPLICATION time. Non-refundable per
    // academy_settings.application_fee_refundable.
    const requiredFee = Number(settings.application_fee ?? 0);

    const registrationFeeRequired =
      settings.registration_type === 'paid' && requiredFee > 0;
    let paidRegistrationFee = 0;
    let registrationFeeReference = '';

    const { data: batch, error: batchError } = await supabase
      .from('academy_batches')
      .select('id')
      .eq('id', batchId)
      .maybeSingle();

    if (batchError) throw batchError;
    if (!batch) return errorResponse('Invalid batch selected', 400);

    if (batchId) {
      const existingApplication = await findExistingBatchApplication({
        userId: user.id,
        email,
        batchId,
      });

      if (existingApplication) {
        return errorResponse('You have already applied for this Film Academy batch.', 409);
      }
    }

    if (registrationFeeRequired) {
      registrationFeeReference = String(body.application_fee_reference ?? '').trim();
      if (!registrationFeeReference) {
        return errorResponse('Registration fee payment is required before submitting this application.', 402);
      }

      let payment;
      try {
        payment = await verifyPaystackTransaction(registrationFeeReference);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to verify registration fee payment';
        const normalized = message.toLowerCase();

        if (normalized.includes('reference') || normalized.includes('not found')) {
          return errorResponse('Registration fee payment reference could not be verified.', 400);
        }

        console.error('Academy registration fee verification failed:', error);
        return errorResponse('Unable to verify registration fee payment. Please try again.', 502);
      }

      paidRegistrationFee = payment.amountKobo / 100;

      if (payment.status !== 'success') {
        return errorResponse('Registration fee payment was not completed successfully.', 402);
      }

      if (payment.currency !== 'NGN') {
        return errorResponse('Registration fee payment must be made in NGN.', 400);
      }

      if (paidRegistrationFee < requiredFee) {
        return errorResponse(
          `Application fee payment is lower than the required ₦${requiredFee.toLocaleString('en-NG')}.`,
          400,
        );
      }

      if (payment.customerEmail && email && payment.customerEmail.toLowerCase() !== email.toLowerCase()) {
        console.warn('Ignoring academy registration fee email mismatch after successful Paystack verification');
      }
    }

    // The account is missing details the applicant just typed — save them so no
    // other module has to ask for them again.
    await backfillProfileDetails(
      user.id,
      { fullName: identity.fullName, phone: identity.phone },
      { fullName, phone },
    );

    const applicationId = crypto.randomUUID();
    const paymentStatus = registrationFeeRequired ? 'paid' : 'not_required';
    const talentCategory = deriveTalentCategory(areasOfInterest);
    const careerGoals = getString(body.career_goals) || motivation;
    const relevantTraining = getString(body.relevant_training) || experience;
    const legacyMotivation = [
      motivation,
      careerGoals ? `Career goals: ${careerGoals}` : '',
      areasOfInterest.length ? `Areas of interest: ${areasOfInterest.join(', ')}` : '',
      relevantTraining ? `Experience/training: ${relevantTraining}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const baseInsertPayload = {
      id: applicationId,
      user_id: user.id,
      status: 'pending',
      full_name: fullName,
      email,
      phone,
      batch_id: batchId,
      payment_reference: registrationFeeReference || null,
      payment_status: paymentStatus,
      application_fee_paid: paidRegistrationFee,
      talent_category: talentCategory,
      motivation: legacyMotivation || motivation,
    };

    const enhancedInsertPayload = {
      ...baseInsertPayload,
      payment_preference: paymentPreference,
      gender: getOptionalString(body.gender),
      date_of_birth: getOptionalString(body.date_of_birth),
      residential_address: getString(body.residential_address),
      city: getString(body.city),
      state: getString(body.state),
      nationality: getString(body.nationality) || getString(body.country) || 'Nigerian',
      areas_of_interest: areasOfInterest,
      highest_education: getString(body.highest_education),
      school_name: getString(body.school_name),
      relevant_training: relevantTraining,
      has_prior_experience: Boolean(relevantTraining),
      experience_description: relevantTraining || null,
      career_goals: careerGoals,
      // Frozen at application time: repricing an area later must not change what
      // a past applicant appears to owe.
      tuition_total_ngn: tuitionTotal,
      terms_accepted: true,
      terms_accepted_at: now,
    };

    let { error: insertError } = await supabase
      .from('academy_applications')
      .insert(enhancedInsertPayload);

    if (insertError && isSchemaMismatchError(insertError)) {
      const retryResult = await supabase.from('academy_applications').insert(baseInsertPayload);
      insertError = retryResult.error;
    }

    if (insertError) {
      if (isDuplicateApplicationError(insertError)) {
        return errorResponse('You have already applied for this Film Academy batch.', 409);
      }

      console.error('Academy application insert failed:', insertError);
      throw new ApiError('Failed to submit application', 500);
    }

    return successResponse({ success: true, applicationId }, 201);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Please sign in to apply', 401);
    }
    console.error('Academy application submit failed:', error);
    return handleApiError(error, 'Failed to submit application');
  }
}

// Fetch open batches for the application form
export async function GET(request: Request) {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('academy_batches')
      .select('id, batch_name, start_date, training_schedule, duration_weeks, status, training_fee_ngn, one_off_discount_pct, installments_count, fee_frequency, description')
      .order('start_date', { ascending: true });

    if (error) return errorResponse('Failed to load batches', 500);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const batches = ((data ?? []) as AcademyBatchRow[]).filter((batch) => {
      const status = String(batch.status ?? '').toLowerCase();
      if (status === 'completed' || status === 'cancelled') return false;

      if (!batch.start_date || !batch.duration_weeks || batch.duration_weeks <= 0) {
        return true;
      }

      const endDate = new Date(batch.start_date);
      endDate.setDate(endDate.getDate() + Number(batch.duration_weeks) * 7);
      endDate.setHours(23, 59, 59, 999);

      return endDate >= today;
    });

    const user = await getOptionalRequestUser(request);
    let appliedBatchIds: string[] = [];
    // What the platform already knows about the applicant. The form renders
    // these read-only instead of asking for them again, and only shows an input
    // for a field the account genuinely lacks. Signed-out callers get null and
    // the form falls back to asking, as before.
    let applicant: {
      full_name: string; email: string; phone: string;
      gender: string; date_of_birth: string; state: string; city: string; country: string;
    } | null = null;

    if (user) {
      try {
        const identity = await getApplicantIdentity(user);
        applicant = {
          full_name: identity.fullName,
          email: identity.email,
          phone: identity.phone,
          gender: identity.gender,
          date_of_birth: identity.dateOfBirth,
          state: identity.state,
          city: identity.city,
          country: identity.country,
        };
      } catch (error) {
        // Prefill is a convenience — never fail the batch list over it.
        console.warn('[academy] could not load applicant identity:', error);
      }

      const query = supabase
        .from('academy_applications')
        .select('batch_id')
        .not('batch_id', 'is', null);

      const { data: appliedRows } = user.email
        ? await query.or(`user_id.eq.${user.id},email.ilike.${user.email}`)
        : await query.eq('user_id', user.id);

      appliedBatchIds = Array.from(
        new Set(
          ((appliedRows ?? []) as Array<{ batch_id?: string | null }>)
            .map((row) => row.batch_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );
    }

    const settings = await getActiveAcademySettings();

    // Admin-managed areas of interest, each carrying a NAIRA fee added to the
    // base application_fee. Returned so the client can show a running total —
    // but the total it shows is never trusted; POST recomputes it from these
    // same rows.
    const { data: areaRows } = await supabase
      .from('academy_interest_areas')
      .select('slug, label, description, fee_ngn')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    // Which areas each batch offers. NO ROWS = unrestricted, so a batch absent
    // from this map offers everything — that is how batches created before the
    // feature keep working.
    const { data: batchAreaRows } = await supabase
      .from('academy_batch_interest_areas')
      .select('batch_id, area_slug')
      .in('batch_id', batches.map((b) => b.id));

    const batchAreas: Record<string, string[]> = {};
    for (const row of (batchAreaRows ?? []) as Array<{ batch_id: string; area_slug: string }>) {
      (batchAreas[row.batch_id] ??= []).push(row.area_slug);
    }

    const interestAreas = (areaRows ?? []).map((a) => ({
      slug: String((a as { slug: string }).slug),
      label: String((a as { label: string }).label),
      description: (a as { description: string | null }).description ?? null,
      fee_ngn: Number((a as { fee_ngn: number | null }).fee_ngn ?? 0),
    }));

    // The cap travels WITH the catalogue so the client never hardcodes its own
    // copy of a commercial rule that lives on the server.
    return successResponse({
      success: true, batches, appliedBatchIds, settings, interestAreas, batchAreas,
      maxInterestAreas: MAX_INTEREST_AREAS_PER_APPLICATION,
      applicant,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load batches');
  }
}
