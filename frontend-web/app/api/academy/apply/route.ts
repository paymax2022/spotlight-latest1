// Film Academy public application endpoint.
// Accepts the application form + payment_preference, stores both.

import { ApiError, errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser, type RequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getActiveAcademySettings, getBatchAreaSlugs } from '@/src/server/services/academy';
import {
  ACADEMY_DELIVERABLES,
  ACADEMY_FEE_EXCLUSIONS,
  ACADEMY_PRICING_FALLBACK_KEY,
  ACADEMY_PRICING_STRUCTURE,
  attachPricingOptions,
  isPricingKey,
  pricingDefinition,
  tuitionForFormat,
  type AcademyPricingKey,
  type AreaPricingOptionRow,
} from '@/src/server/services/academy/pricing';
import { getOrCreateUserProfile } from '@/src/server/user/profile';
import { verifyPaystackTransaction } from '@/src/lib/payments';
import {
  consumeAcademyFeeIntent,
  getAcademyFeeIntentByReference,
  releaseAcademyFeeIntent,
  type AcademyFeeIntent,
} from '@/src/server/payments/academy-fee-intents';

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

/**
 * Parse `area_selections: [{slug, key}]` into {slug: key}, or null when the
 * client used the legacy flat shape. 'invalid' rejects unknown formats or a
 * duplicated area before anything is priced.
 */
function parseAreaSelections(value: unknown): Record<string, AcademyPricingKey> | 'invalid' | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: Record<string, AcademyPricingKey> = {};
  for (const item of value) {
    const slug = getString((item as { slug?: unknown })?.slug);
    const key = getString((item as { key?: unknown })?.key);
    if (!slug || !isPricingKey(key)) return 'invalid';
    if (out[slug]) return 'invalid';
    out[slug] = key;
  }
  return out;
}

/** Tuition when each area carries its own format — the sum of the chosen subs. */
function tuitionForSelections(
  areas: Array<{ id: string; slug: string }>,
  selections: Record<string, AcademyPricingKey>,
  rows: AreaPricingOptionRow[],
): number {
  return areas.reduce((sum, a) => {
    const key = selections[a.slug] ?? ACADEMY_PRICING_FALLBACK_KEY;
    const row = rows.find((r) => r.area_id === a.id && r.key === key);
    return sum + (row ? Number(row.price_ngn) : pricingDefinition(key).price_ngn);
  }, 0);
}

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown>;
    if (!body) return errorResponse('Invalid JSON body', 400);
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
    // Accordion selection: the client may send each area WITH its own format —
    // {"areas_of_interest": ["acting"], "area_selections": [{slug, key}]}.
    // When present, the selections are authoritative and define the areas.
    const areaSelections = parseAreaSelections(body.area_selections);
    if (areaSelections === 'invalid') {
      return errorResponse('Each selection needs a known area and a valid training format', 400);
    }
    const areasOfInterest = areaSelections
      ? Object.keys(areaSelections)
      : getStringArray(body.areas_of_interest);
    // Which training format the tuition is priced in. Optional: a client from
    // before this structure sends nothing, and is priced in the cheapest
    // (weekend, no boarding) format rather than the retired per-area fee.
    const pricingOptionKey = getString(body.pricing_option_key);
    if (pricingOptionKey && !isPricingKey(pricingOptionKey)) {
      return errorResponse('Unknown training format', 400);
    }
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

    // TUITION is priced from the admin-managed rows: the chosen format's price
    // for every area the applicant selected. Computed HERE — the client renders
    // a running total for the user's benefit, but it could claim any number, so
    // nothing it sends is used in this sum.
    const { data: areaRows, error: areaError } = await supabase
      .from('academy_interest_areas')
      .select('id, slug, fee_ngn, is_active')
      .in('slug', areasOfInterest);
    if (areaError) throw areaError;

    const activeAreas = (areaRows ?? []).filter(
      (a) => (a as { is_active: boolean }).is_active,
    ) as Array<{ id: string; slug: string; fee_ngn: number | null }>;

    // An unknown or retired slug must not silently price at zero — that would
    // let a crafted request buy a cheaper application. Reject it instead.
    if (activeAreas.length !== areasOfInterest.length) {
      const known = new Set(activeAreas.map((a) => String((a as { slug: string }).slug)));
      const bad = areasOfInterest.filter((a) => !known.has(a));
      return errorResponse(`Unknown area of interest: ${bad.join(', ')}`, 400);
    }

    // A batch offers EXACTLY the trainings linked to it. Selecting one it does
    // not offer is rejected here rather than quietly charged — the client
    // filters the list, but the client is not what decides. A batch with no
    // trainings linked yet offers nothing and accepts no application; the admin
    // console requires at least one training before a batch can be saved.
    const offered = await getBatchAreaSlugs(supabase, batchId);
    if (offered.length === 0) {
      return errorResponse(
        'This batch has no trainings configured yet — please choose another batch.',
        409,
      );
    }
    const notOffered = areasOfInterest.filter((a) => !offered.includes(a));
    if (notOffered.length > 0) {
      return errorResponse(
        `This batch does not offer: ${notOffered.join(', ')}`,
        400,
      );
    }

    // TUITION, not an application fee. The composite format table prices each
    // selected area — payable on acceptance and refundable. It is recorded
    // against the application for later billing and is deliberately NOT part
    // of what is charged now.
    // This was previously added to the amount collected at submit, which would
    // have taken ~₦255,000 up front, non-refundably, for a Film Directing
    // application nobody had reviewed yet.
    const effectivePricingKey: AcademyPricingKey = isPricingKey(pricingOptionKey)
      ? pricingOptionKey
      : ACADEMY_PRICING_FALLBACK_KEY;
    const { data: tuitionOptionRows, error: tuitionOptionsError } = await supabase
      .from('academy_area_pricing_options')
      .select('area_id, key, label, note, price_ngn, sort_order')
      .in('area_id', activeAreas.map((a) => a.id));
    if (tuitionOptionsError) throw tuitionOptionsError;
    const optionRows = (tuitionOptionRows ?? []) as AreaPricingOptionRow[];
    const tuitionTotal = areaSelections
      ? tuitionForSelections(activeAreas, areaSelections, optionRows)
      : tuitionForFormat(activeAreas, effectivePricingKey, optionRows);

    // The only thing payable at APPLICATION time. Non-refundable per
    // academy_settings.application_fee_refundable.
    const requiredFee = Number(settings.application_fee ?? 0);

    const registrationFeeRequired =
      settings.registration_type === 'paid' && requiredFee > 0;
    let paidRegistrationFee = 0;
    let registrationFeeReference = '';
    // Set when application_fee_reference resolves to a server-minted intent —
    // the intent's state and recorded verified amount then govern, and the
    // intent is consumed below so one charge can never file two applications.
    let applicationFeeIntent: AcademyFeeIntent | null = null;

    const { data: batch, error: batchError } = await supabase
      .from('academy_batches')
      .select('id, max_students')
      .eq('id', batchId)
      .maybeSingle();

    if (batchError) {
      // academy_batches.id is a uuid column — a malformed batch_id makes
      // PostgREST answer 22P02. That is bad client input (400), not a fault.
      if (batchError.code === '22P02') {
        return errorResponse('Invalid batch selected', 400);
      }
      throw batchError;
    }
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

    // Capacity, not enrolled_count. academy_batches.enrolled_count is bumped by
    // a DB trigger on every INSERT into academy_applications regardless of
    // status, so a pile of rejected applications would inflate it forever —
    // it is not "seats taken" and must not be read here. A seat is occupied by
    // a 'pending' application (awaiting review, might still be approved) or an
    // count against the cap. max_students === null means unlimited — skip the
    // check entirely rather than treating null as zero.
    const maxStudents = (batch as { max_students: number | null }).max_students;
    if (maxStudents !== null && maxStudents !== undefined) {
      const { count: seatsTaken, error: capacityError } = await supabase
        .from('academy_applications')
        .select('id', { count: 'exact', head: true })
        .eq('batch_id', batchId)
        .in('status', ['pending', 'approved']);

      if (capacityError) throw capacityError;

      if ((seatsTaken ?? 0) >= maxStudents) {
        return errorResponse('This batch is at full capacity', 409);
      }
    }

    // Calculate expected payment: application fee + first tuition installment
    // Tuition is now collected at application time, not after approval
    const areasTotal = selectedAreas.reduce((sum, area) => {
      const selection = (body.area_selections ?? []).find((s: any) => s.slug === area.slug);
      const key = selection?.key ?? '';
      return sum + ((area.pricing_options ?? []).find((o: any) => o.key === key)?.price_ngn ?? area.fee_ngn ?? 0);
    }, 0);
    const calculatedTuition = areasTotal > 0 ? areasTotal : Number(batch?.training_fee_ngn ?? 0);
    const paymentPref = String(body.payment_preference ?? 'installment').toLowerCase();
    const firstTuitionPayment = paymentPref === 'one_off' ? calculatedTuition : (calculatedTuition / 3);
    const expectedTotalPayment = requiredFee + firstTuitionPayment;

    if (requiredFee > 0 || calculatedTuition > 0) {
      registrationFeeReference = String(body.application_fee_reference ?? '').trim();
      if (!registrationFeeReference) {
        return errorResponse('Payment is required before submitting this application.', 402);
      }

      // A server-minted fee intent (POST /api/academy/application-fee/initiate)
      // is authoritative for this reference: the webhook/recover fulfil path
      // already verified the charge against the frozen quote, so the intent's
      // state — not a live re-verify — decides here. References minted before
      // intents existed (or by older clients) keep the live-verify path below.
      applicationFeeIntent = await getAcademyFeeIntentByReference(registrationFeeReference);

      if (applicationFeeIntent) {
        // Payer-scoped: a reference initiated under another account cannot
        // fund this application.
        if (applicationFeeIntent.user_id && applicationFeeIntent.user_id !== user.id) {
          return errorResponse('This payment reference belongs to a different account', 403);
        }
        if (applicationFeeIntent.status === 'consumed') {
          return errorResponse('This payment reference has already been used for an application.', 409);
        }
        if (applicationFeeIntent.status === 'pending') {
          // The charge exists but fulfilment has not landed yet — the webhook
          // or the reconcile sweep marks it paid; a resubmit reuses the same
          // reference (the client keeps it) rather than charging again.
          return errorResponse(
            'Your payment is still being confirmed — please submit again in a moment.',
            402,
          );
        }
        if (applicationFeeIntent.status !== 'paid') {
          // amount_mismatch / failed — terminal, this charge cannot apply.
          return errorResponse('Registration fee payment was not completed successfully.', 402);
        }
        // The amount Paystack actually collected, recorded at fulfil — never
        // the client's claim and never just the quote.
        paidRegistrationFee =
          Number(applicationFeeIntent.verified_amount_kobo ?? applicationFeeIntent.amount_kobo) / 100;

        // Payment should cover both application fee and first tuition installment
        if (paidRegistrationFee < expectedTotalPayment) {
          return errorResponse(
            `Payment is lower than the required ₦${expectedTotalPayment.toLocaleString('en-NG')} (application fee + tuition).`,
            400,
          );
        }
      } else {
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

      // Payment should cover both application fee and first tuition installment
      if (paidRegistrationFee < expectedTotalPayment) {
        return errorResponse(
          `Payment is lower than the required ₦${expectedTotalPayment.toLocaleString('en-NG')} (application fee + tuition).`,
          400,
        );
      }

      if (payment.customerEmail && email && payment.customerEmail.toLowerCase() !== email.toLowerCase()) {
        console.warn('Ignoring academy payment email mismatch after successful Paystack verification');
      }
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

    // Claim the paid intent for THIS application BEFORE inserting. The consume
    // is guarded on status='paid', so only one submit can ever win a charge —
    // a raced or replayed submit transitions nothing and gets a 409 instead of
    // a second application off the same fee.
    if (applicationFeeIntent) {
      const claimed = await consumeAcademyFeeIntent(registrationFeeReference, applicationId);
      if (!claimed) {
        return errorResponse('This payment reference has already been used for an application.', 409);
      }
    }
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
      // The format the tuition above was priced in. With per-area selections it
      // is recorded only when every area shares one format, for readers of the
      // single-key column; pricing_selections then carries the full map.
      pricing_option_key: areaSelections
        ? (Object.values(areaSelections).every((k) => k === Object.values(areaSelections)[0])
            ? Object.values(areaSelections)[0]
            : null)
        : (pricingOptionKey || null),
      pricing_selections: areaSelections ?? null,
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

      // The claim must not burn with a failed insert — release the intent back
      // to 'paid' so the same charge can fund the retry.
      if (applicationFeeIntent) {
        await releaseAcademyFeeIntent(registrationFeeReference).catch((releaseError) => {
          console.error('Academy fee intent release after insert failure failed:', releaseError);
        });
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

    // Admin-managed areas of interest. Applicants are priced by the composite
    // format structure (academy_area_pricing_options) — five formats per area,
    // delivered alongside each area so the form can show the real price for
    // the format chosen. fee_ngn travels only so an older client still renders.
    const { data: areaRows } = await supabase
      .from('academy_interest_areas')
      .select('id, slug, label, description, fee_ngn')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    const { data: areaOptionRows } = await supabase
      .from('academy_area_pricing_options')
      .select('area_id, key, label, note, price_ngn, sort_order');

    // Every batch carries an entry here, possibly empty: a batch offers
    // EXACTLY the trainings linked to it, and an empty entry means it offers
    // nothing yet. Only a COMPLETELY absent map (an older server) still means
    // "unrestricted" to the clients.
    const { data: batchAreaRows } = await supabase
      .from('academy_batch_interest_areas')
      .select('batch_id, area_slug')
      .in('batch_id', batches.map((b) => b.id));

    const batchAreas: Record<string, string[]> = {};
    for (const b of batches) batchAreas[b.id] = [];
    for (const row of (batchAreaRows ?? []) as Array<{ batch_id: string; area_slug: string }>) {
      (batchAreas[row.batch_id] ??= []).push(row.area_slug);
    }

    const pricedAreas = attachPricingOptions(
      ((areaRows ?? []) as Array<{ id: string; slug: string; label: string;
        description: string | null; fee_ngn: number | null }>).map((a) => ({
        id: a.id,
        slug: String(a.slug),
        label: String(a.label),
        description: a.description ?? null,
        fee_ngn: Number(a.fee_ngn ?? 0),
      })),
      (areaOptionRows ?? []) as AreaPricingOptionRow[],
    );
    // The uuid keyed the pricing rows — it is not part of the client contract.
    const interestAreas = pricedAreas.map((a) => ({
      slug: a.slug,
      label: a.label,
      description: a.description,
      fee_ngn: a.fee_ngn,
      pricing_options: a.pricing_options,
    }));

    // The cap travels WITH the catalogue so the client never hardcodes its own
    // copy of a commercial rule that lives on the server.
    return successResponse({
      success: true, batches, appliedBatchIds, settings, interestAreas, batchAreas,
      maxInterestAreas: MAX_INTEREST_AREAS_PER_APPLICATION,
      applicant,
      // Format identity only — the prices live in each area's pricing_options,
      // so the structure can never drift from what an area is actually priced
      // at. Deliverables and fee exclusions travel the same way: no client
      // hardcodes this copy.
      pricingStructure: ACADEMY_PRICING_STRUCTURE.map(({ key, label, note, sort_order }) => ({
        key, label, note, sort_order,
      })),
      deliverables: ACADEMY_DELIVERABLES,
      feeExclusions: ACADEMY_FEE_EXCLUSIONS,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load batches');
  }
}
