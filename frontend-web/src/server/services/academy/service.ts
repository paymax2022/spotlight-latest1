import { createAdminClient, createClient } from '@/lib/supabase/server';
import { ApiError } from '@/lib/api/responses';
import type {
  AcademyApplicationInput,
  AcademyBatchMutationInput,
  AcademyReviewUpdateInput,
  AcademySettingsUpdateInput,
} from '@/lib/validation/academy';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getOptionalEnv } from '@/lib/config/env';
import { sendTransactionalEmail } from '@/lib/email/transactional';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

type AcademyBatchRow = {
  batch_name: string;
};

type AcademyPaymentContext = {
  id: string;
  email: string;
  full_name: string;
  payment_reference: string | null;
  payment_status: string | null;
  batch_id: string;
  academy_batches?: {
    batch_name?: string | null;
  } | null;
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

function deriveTalentCategory(areasOfInterest: string[]): string {
  if (areasOfInterest.length === 0) {
    return 'other';
  }

  for (const area of areasOfInterest) {
    const mapped = LEGACY_TALENT_CATEGORY_MAP[area];
    if (mapped) return mapped;
  }

  return 'other';
}

function isSchemaMismatchError(
  error: { code?: string; message?: string; details?: string | null } | null
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

function dedupeBatchesByName<T extends AcademyBatchRow>(batches: T[]) {
  const seen = new Set<string>();

  return batches.filter((batch) => {
    if (seen.has(batch.batch_name)) {
      return false;
    }

    seen.add(batch.batch_name);
    return true;
  });
}

async function getLatestActiveAcademySettings(supabase: ServerSupabaseClient) {
  return supabase
    .from('academy_settings')
    .select('*')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
}

function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() || null;
}

async function sendAcademyPaymentConfirmationEmail(input: {
  email: string;
  fullName: string;
  paymentReference: string;
  amountPaid: number;
  batchName?: string | null;
}) {
  const siteUrl = getOptionalEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:4028') || '';
  const batchLabel = input.batchName || 'Film Academy';
  const amountFormatted = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
  }).format(input.amountPaid);

  return sendTransactionalEmail({
    to: input.email,
    subject: 'Spotlight Film Academy Payment Confirmation',
    text: [
      `Hello ${input.fullName},`,
      '',
      'Your Spotlight Film Academy payment has been confirmed successfully.',
      `Batch: ${batchLabel}`,
      `Amount Paid: ${amountFormatted}`,
      `Payment Reference: ${input.paymentReference}`,
      '',
      `Continue from your academy dashboard: ${siteUrl}/film-academy/dashboard`,
      '',
      'Spotlight Team',
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
        <h2 style="margin-bottom: 12px;">Payment Confirmed</h2>
        <p>Hello ${input.fullName},</p>
        <p>Your Spotlight Film Academy payment has been confirmed successfully.</p>
        <div style="padding: 16px; border: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="margin: 0 0 8px;"><strong>Batch:</strong> ${batchLabel}</p>
          <p style="margin: 0 0 8px;"><strong>Amount Paid:</strong> ${amountFormatted}</p>
          <p style="margin: 0;"><strong>Payment Reference:</strong> ${input.paymentReference}</p>
        </div>
        <p>
          Continue from your academy dashboard:
          <a href="${siteUrl}/film-academy/dashboard">${siteUrl}/film-academy/dashboard</a>
        </p>
        <p>Spotlight Team</p>
      </div>
    `,
  });
}

async function resolveApplicationOwnerId(supabase: ServerSupabaseClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    return null;
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();
  return profile?.id || null;
}

export async function submitAcademyApplication(input: AcademyApplicationInput) {
  const supabase = await createClient();
  const userId = await resolveApplicationOwnerId(supabase);

  const [batchRes, settingsRes] = await Promise.all([
    supabase.from('academy_batches').select('id').eq('id', input.batch_id).single(),
    getLatestActiveAcademySettings(supabase),
  ]);

  if (!batchRes.data) {
    throw new ApiError('Invalid batch selected', 400);
  }

  const payment_status =
    settingsRes.data?.registration_type === 'paid' && settingsRes.data?.application_fee > 0
      ? 'pending'
      : 'not_required';

  const talent_category = deriveTalentCategory(input.areas_of_interest);
  const applicationId = crypto.randomUUID();

  const baseInsertPayload = {
    id: applicationId,
    user_id: userId,
    status: 'pending',
    full_name: input.full_name,
    email: input.email,
    phone: input.phone,
    batch_id: input.batch_id,
    payment_status,
    application_fee_paid: 0,
    talent_category,
  };

  const enhancedInsertPayload = {
    ...baseInsertPayload,
    gender: input.gender,
    date_of_birth: input.date_of_birth,
    residential_address: input.residential_address,
    city: input.city,
    state: input.state,
    nationality: input.nationality,
    areas_of_interest: input.areas_of_interest,
    highest_education: input.highest_education,
    school_name: input.school_name,
    relevant_training: input.relevant_training,
    has_prior_experience: input.has_prior_experience,
    experience_description: input.has_prior_experience ? input.experience_description : null,
    motivation: input.motivation,
    career_goals: input.career_goals,
    terms_accepted: input.terms_accepted,
    terms_accepted_at: input.terms_accepted ? new Date().toISOString() : null,
  };

  let { error: insertError } = await supabase
    .from('academy_applications')
    .insert(enhancedInsertPayload);

  if (insertError && isSchemaMismatchError(insertError)) {
    const legacyMotivation = [
      input.motivation,
      input.career_goals ? `Career goals: ${input.career_goals}` : '',
      input.areas_of_interest.length > 0
        ? `Areas of interest: ${input.areas_of_interest.join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const retryResult = await supabase.from('academy_applications').insert({
      ...baseInsertPayload,
      motivation: legacyMotivation || input.motivation || 'Film Academy application submitted',
    });

    insertError = retryResult.error;
  }

  if (insertError) {
    console.error('Application insert error:', insertError);
    throw new ApiError('Failed to submit application', 500);
  }

  return {
    application_id: applicationId,
    payment_status,
    payment_required: payment_status === 'pending',
    application_fee: settingsRes.data?.application_fee || 0,
  };
}

export async function confirmAcademyPayment(applicationId: string, paymentReference: string) {
  const { verifyPaystackTransaction } = await import('@/lib/payments/paystack');
  const adminSupabase = getOptionalEnv('SUPABASE_SERVICE_ROLE_KEY') ? createAdminClient() : null;

  let payment;

  try {
    payment = await verifyPaystackTransaction(paymentReference);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to verify Paystack transaction';

    if (message.toLowerCase().includes('reference not found')) {
      throw new ApiError('Payment reference could not be verified', 400);
    }

    throw new ApiError(message, 502);
  }

  if (payment.status !== 'success') {
    throw new ApiError('Payment has not been completed successfully', 402);
  }

  if (payment.currency !== 'NGN') {
    throw new ApiError('Unexpected payment currency returned by gateway', 400);
  }

  const amountPaid = payment.amountKobo / 100;
  let paymentContext: AcademyPaymentContext | null = null;

  if (adminSupabase) {
    const { data, error } = await adminSupabase
      .from('academy_applications')
      .select(
        'id, email, full_name, payment_reference, payment_status, batch_id, academy_batches(batch_name)'
      )
      .eq('id', applicationId)
      .maybeSingle();

    if (error) {
      console.error('Failed to fetch academy application before payment confirmation:', error);
    } else {
      paymentContext = data as AcademyPaymentContext | null;
    }
  }

  const rpcClient = await createClient();
  const { data: rpcResult, error: rpcError } = await rpcClient.rpc('confirm_academy_payment', {
    p_application_id: applicationId,
    p_payment_reference: payment.reference,
    p_amount_paid: amountPaid,
    p_customer_email: payment.customerEmail,
  });

  if (!rpcError) {
    const normalizedResult = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
    let confirmationEmailSent = false;
    let confirmationEmailReason: string | undefined;

    if (paymentContext?.email && !normalizedResult?.already_confirmed) {
      const emailResult = await sendAcademyPaymentConfirmationEmail({
        email: paymentContext.email,
        fullName: paymentContext.full_name,
        paymentReference: payment.reference,
        amountPaid,
        batchName: paymentContext.academy_batches?.batch_name || null,
      }).catch((error) => ({
        sent: false,
        reason: error instanceof Error ? error.message : 'Failed to send confirmation email.',
      }));

      confirmationEmailSent = Boolean(emailResult.sent);
      confirmationEmailReason = emailResult.sent ? undefined : emailResult.reason;
    }

    return {
      success: true,
      already_confirmed: Boolean(normalizedResult?.already_confirmed),
      confirmationEmailSent,
      confirmationEmailReason,
    };
  }

  const rpcMessage = rpcError.message || '';
  const rpcText = `${rpcError.code || ''} ${rpcError.details || ''} ${rpcMessage}`.toLowerCase();
  const rpcMissing =
    rpcText.includes('could not find the function') ||
    rpcText.includes('schema cache') ||
    rpcText.includes('pgrst202') ||
    rpcText.includes('42883');

  if (!rpcMissing) {
    if (rpcMessage.toLowerCase().includes('application not found')) {
      throw new ApiError('Application not found', 404);
    }
    if (rpcMessage.toLowerCase().includes('different payment reference')) {
      throw new ApiError('Application already has a different payment reference', 409);
    }
    if (rpcMessage.toLowerCase().includes('lower than required application fee')) {
      throw new ApiError('Verified payment amount is lower than required application fee', 400);
    }
    if (rpcMessage.toLowerCase().includes('payment email does not match')) {
      console.warn(
        'Ignoring academy payment email mismatch after successful Paystack verification'
      );
    } else {
      console.error('Academy payment confirmation RPC error:', rpcError);
      throw new ApiError('Failed to confirm payment', 500);
    }
  }

  if (!adminSupabase) {
    console.error('Academy payment confirmation RPC missing and no service role configured');
    throw new ApiError(
      'Payment confirmation is not fully configured yet. Apply the latest database migration or add SUPABASE_SERVICE_ROLE_KEY.',
      503
    );
  }

  const [applicationRes, settingsRes] = await Promise.all([
    adminSupabase
      .from('academy_applications')
      .select(
        'id, email, full_name, payment_reference, payment_status, batch_id, academy_batches(batch_name)'
      )
      .eq('id', applicationId)
      .maybeSingle(),
    getLatestActiveAcademySettings(adminSupabase),
  ]);

  const { data: existingApplication, error: fetchError } = applicationRes;

  if (fetchError) {
    console.error('Failed to fetch academy application for payment confirmation:', fetchError);
    throw new ApiError('Could not validate application payment', 500);
  }

  if (settingsRes.error) {
    console.error('Failed to fetch academy settings for payment confirmation:', settingsRes.error);
    throw new ApiError('Could not validate application payment', 500);
  }

  if (!existingApplication) {
    throw new ApiError('Application not found', 404);
  }

  if (existingApplication.payment_status === 'paid') {
    return { already_confirmed: true };
  }

  if (
    existingApplication.payment_reference &&
    existingApplication.payment_reference !== paymentReference
  ) {
    throw new ApiError('Application already has a different payment reference', 409);
  }

  const expectedAmount =
    settingsRes.data?.registration_type === 'paid'
      ? Number(settingsRes.data.application_fee || 0)
      : 0;

  if (expectedAmount > 0 && amountPaid < expectedAmount) {
    throw new ApiError('Verified payment amount is lower than required application fee', 400);
  }

  if (
    existingApplication.email &&
    payment.customerEmail &&
    normalizeEmail(existingApplication.email) !== normalizeEmail(payment.customerEmail)
  ) {
    console.warn('Ignoring academy payment email mismatch after successful Paystack verification');
  }

  const { error: updateError } = await adminSupabase
    .from('academy_applications')
    .update({
      payment_reference: payment.reference,
      payment_status: 'paid',
      application_fee_paid: amountPaid,
    })
    .eq('id', applicationId);

  if (updateError) {
    console.error('Failed to update academy payment status:', updateError);
    throw new ApiError('Failed to confirm payment', 500);
  }

  let confirmationEmailSent = false;
  let confirmationEmailReason: string | undefined;

  if (existingApplication.email) {
    const emailResult = await sendAcademyPaymentConfirmationEmail({
      email: existingApplication.email,
      fullName: (existingApplication as AcademyPaymentContext).full_name,
      paymentReference: payment.reference,
      amountPaid,
      batchName:
        ((existingApplication as AcademyPaymentContext).academy_batches?.batch_name as
          | string
          | null) || null,
    }).catch((error) => ({
      sent: false,
      reason: error instanceof Error ? error.message : 'Failed to send confirmation email.',
    }));

    confirmationEmailSent = Boolean(emailResult.sent);
    confirmationEmailReason = emailResult.sent ? undefined : emailResult.reason;
  }

  return { success: true, confirmationEmailSent, confirmationEmailReason };
}

export async function getAcademyApplicationForViewer(
  supabase: ServerSupabaseClient,
  applicationId: string,
  viewerId: string,
  role: string | null
) {
  const { data: application, error } = await supabase
    .from('academy_applications')
    .select(
      `
      *,
      academy_batches(batch_name, start_date, training_schedule),
      academy_application_uploads(*)
    `
    )
    .eq('id', applicationId)
    .single();

  if (error || !application) {
    throw new ApiError('Application not found', 404);
  }

  if (application.user_id !== viewerId && role !== 'admin') {
    throw new ApiError('Forbidden', 403);
  }

  return application;
}

export async function getAcademyAdminDashboard(supabase: ServerSupabaseClient) {
  const [settingsRes, batchesRes, applicationsRes] = await Promise.all([
    getLatestActiveAcademySettings(supabase),
    supabase.from('academy_batches').select('*').order('start_date', { ascending: true }),
    supabase
      .from('academy_applications')
      .select('*, academy_batches(batch_name, start_date, training_schedule)')
      .order('created_at', { ascending: false }),
  ]);

  if (settingsRes.error) {
    throw new ApiError('Failed to load academy settings', 500);
  }

  if (batchesRes.error) {
    throw new ApiError('Failed to load academy batches', 500);
  }

  if (applicationsRes.error) {
    throw new ApiError('Failed to load academy applications', 500);
  }

  return {
    settings: settingsRes.data,
    batches: dedupeBatchesByName((batchesRes.data as AcademyBatchRow[] | null) || []),
    applications: applicationsRes.data || [],
  };
}

export async function updateAcademySettings(
  supabase: ServerSupabaseClient,
  settingsId: string,
  input: AcademySettingsUpdateInput
) {
  const { data, error } = await supabase
    .from('academy_settings')
    .update({
      registration_type: input.registration_type,
      application_fee: input.application_fee,
      application_fee_refundable: input.application_fee_refundable,
      tuition_fee: input.tuition_fee,
      updated_at: new Date().toISOString(),
    })
    .eq('id', settingsId)
    .select('*')
    .single();

  if (error || !data) {
    throw new ApiError('Failed to update academy settings', 500);
  }

  return data;
}

export async function saveAcademyBatch(
  supabase: ServerSupabaseClient,
  input: AcademyBatchMutationInput,
  batchId?: string
) {
  const payload = {
    batch_name: input.batch_name,
    start_date: input.start_date,
    training_schedule: input.training_schedule,
    duration_weeks: input.duration_weeks,
    max_students: input.max_students,
    description: input.description,
    benefits: input.benefits,
    ...(input.status ? { status: input.status } : {}),
  };

  const query = batchId
    ? supabase.from('academy_batches').update(payload).eq('id', batchId)
    : supabase.from('academy_batches').insert({
        ...payload,
        status: input.status || 'upcoming',
      });

  const { data, error } = await query.select('*').single();

  if (error || !data) {
    throw new ApiError(
      batchId ? 'Failed to update academy batch' : 'Failed to create academy batch',
      500
    );
  }

  return data;
}

export async function deleteAcademyBatch(supabase: ServerSupabaseClient, batchId: string) {
  const { error } = await supabase.from('academy_batches').delete().eq('id', batchId);

  if (error) {
    throw new ApiError('Failed to delete academy batch', 500);
  }
}

export async function updateAcademyApplicationReview(
  supabase: SupabaseClient,
  applicationId: string,
  reviewerId: string,
  input: AcademyReviewUpdateInput
) {
  const reviewedAt = new Date().toISOString();
  const updateData: Record<string, unknown> = {
    reviewed_at: reviewedAt,
  };

  const { data: reviewerProfile } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('id', reviewerId)
    .maybeSingle();

  if (reviewerProfile?.id) {
    updateData.reviewed_by = reviewerId;
  }

  if (input.status) {
    updateData.status = input.status;
  }
  if (input.rejection_reason !== undefined) {
    updateData.rejection_reason = input.rejection_reason;
  }
  if (input.admin_notes !== undefined) {
    updateData.admin_notes = input.admin_notes;
  }

  const runUpdate = async (payload: Record<string, unknown>) =>
    supabase
      .from('academy_applications')
      .update(payload)
      .eq('id', applicationId)
      .select()
      .maybeSingle();

  let { data: application, error } = await runUpdate(updateData);

  // Legacy schema fallback:
  // some environments may not have reviewed_* / rejection_reason / admin_notes columns yet.
  if (error && isSchemaMismatchError(error)) {
    const minimalUpdate: Record<string, unknown> = {};

    if (input.status) {
      minimalUpdate.status = input.status;
    }

    ({ data: application, error } = await runUpdate(minimalUpdate));
  }

  // Reviewer profile FK fallback:
  // if reviewed_by points to a non-existent user_profiles row, persist decision without reviewer link.
  if (error && error.code === '23503') {
    const noReviewerUpdate = { ...updateData };
    delete noReviewerUpdate.reviewed_by;

    ({ data: application, error } = await runUpdate(noReviewerUpdate));
  }

  if (error) {
    console.error('Failed to update academy application review:', error);
    throw new ApiError('Failed to update application', 500);
  }

  if (!application) {
    throw new ApiError('Application not found', 404);
  }

  return application;
}
