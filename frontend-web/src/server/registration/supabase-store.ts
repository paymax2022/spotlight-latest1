import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  buildRegistrationSteps,
  getTalentSkillsForContestCategory,
  resolveContestRegistration,
  contestRegistrationCatalog,
} from '@/src/features/registration/config';
import {
  calculateCompletionPercent,
  deriveAge,
  runBasicFraudChecks,
  validateStepData,
} from '@/src/features/registration/validation';
import { ACCOUNT_PROVIDED_KEYS } from '@/src/features/registration/account-prefill';
import {
  listRegistrationContests,
  getRegistrationContestBySlug,
} from '@/src/server/registration/store';
// Contest definitions also stay in the in-memory catalog; re-export so routes
// importing them from this module resolve.
export { listRegistrationContests, getRegistrationContestBySlug } from '@/src/server/registration/store';
import type {
  ContestRegistrationDefinition,
  ApplicationStatus,
  RegistrationDraft,
  RegistrationStepKey,
  RegistrationStatusEvent,
  RegistrationReviewInput,
} from '@/src/features/registration/types';

// Service-role Supabase client, created LAZILY. A module-level createClient()
// throws "supabaseUrl is required" the moment anything imports this file with
// env unset (vitest collection, next build) — the golden-path regression suite
// broke on exactly that. Memoized so runtime behaviour is unchanged.
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

function nowIso() {
  return new Date().toISOString();
}

function makeReference(contestSlug: string) {
  const prefix = contestSlug.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase() || 'SPOT';
  const stamp = Date.now().toString().slice(-6);
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${stamp}-${rand}`;
}

export async function getRegistrationDraft(applicationId: string): Promise<RegistrationDraft | null> {
  if (!applicationId || typeof applicationId !== 'string') {
    throw new Error('Invalid application ID');
  }

  const { data, error } = await getSupabase()
    .from('registrations')
    .select('*')
    .eq('id', applicationId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // Not found
      console.warn('[registration/supabase-store] registration not found:', applicationId);
      return null;
    }
    throw new Error(`Failed to fetch registration: ${error.message}`);
  }

  return rowToDraft(data);
}

export async function saveRegistrationStep(params: {
  applicationId: string;
  stepKey: RegistrationStepKey;
  values: Record<string, unknown>;
}) {
  if (!params?.applicationId || typeof params.applicationId !== 'string') {
    throw new Error('Invalid application ID');
  }
  if (!params?.stepKey) {
    throw new Error('Step key is required');
  }
  if (!params?.values || typeof params.values !== 'object') {
    throw new Error('Values must be a non-empty object');
  }

  const draft = await getRegistrationDraft(params.applicationId);
  if (!draft) {
    throw new Error('Application not found.');
  }

  const mergedData = {
    ...draft.formData,
    ...params.values,
  };

  // Lock contest identity
  const lockedContest = getRegistrationContestBySlug(draft.contestSlug) || resolveContestRegistration(draft.contestSlug);
  if (lockedContest) {
    mergedData['contestSlug'] = lockedContest.slug;
    mergedData['contest.title'] = lockedContest.title;
    mergedData['contest.category'] = lockedContest.contestCategory;
    mergedData['contest.type'] = lockedContest.contestType;
    mergedData['contest.categoryKey'] = lockedContest.categoryQuestionSet;
    mergedData['derived.availableContestTitles'] = [lockedContest.title];
    mergedData['derived.auditionStates'] = lockedContest.auditionStates || [];
    mergedData['derived.applicantCategories'] = lockedContest.applicantCategories || [];
    mergedData['derived.legalAdultAge'] = lockedContest.legalAdultAge;
    mergedData['derived.requiresMedical'] = lockedContest.requiresMedical;
    mergedData['derived.requiresBootcampReadiness'] = lockedContest.requiresBootcampReadiness;
    mergedData['derived.supportsVoting'] = lockedContest.supportsVoting;
    mergedData['derived.supportsAuditionScheduling'] = lockedContest.supportsAuditionScheduling;
    mergedData['derived.isPaidContest'] = lockedContest.isPaid;
    mergedData['derived.allowedTalentSkills'] = getTalentSkillsForContestCategory(lockedContest.contestCategory);
    mergedData['derived.formSchema'] = lockedContest.formSchema || null;
    mergedData['payment.feeAmount'] = lockedContest.registrationFeeNgn || 0;
  }

  const selectedContestTitle = String(mergedData['contest.title'] || '').trim();
  if (selectedContestTitle) {
    const selectedContest = listRegistrationContests().find((item) => item.title === selectedContestTitle);
    if (selectedContest) {
      mergedData['contestSlug'] = selectedContest.slug;
      mergedData['contest.category'] = selectedContest.contestCategory;
      mergedData['contest.type'] = selectedContest.contestType;
      mergedData['contest.categoryKey'] = selectedContest.categoryQuestionSet;
      mergedData['contest.region'] = String(mergedData['contest.region'] || selectedContest.auditionStates?.[0] || '');
      const allowedApplicantCategories = selectedContest.applicantCategories || [];
      const requestedApplicantCategory = String(mergedData['contest.applicantCategory'] || '');
      mergedData['contest.applicantCategory'] =
        allowedApplicantCategories.includes(requestedApplicantCategory)
          ? requestedApplicantCategory
          : String(allowedApplicantCategories[0] || '');
      mergedData['derived.auditionStates'] = selectedContest.auditionStates || [];
      mergedData['derived.applicantCategories'] = allowedApplicantCategories;
      mergedData['derived.legalAdultAge'] = selectedContest.legalAdultAge;
      mergedData['derived.requiresMedical'] = selectedContest.requiresMedical;
      mergedData['derived.requiresBootcampReadiness'] = selectedContest.requiresBootcampReadiness;
      mergedData['derived.supportsVoting'] = selectedContest.supportsVoting;
      mergedData['derived.supportsAuditionScheduling'] = selectedContest.supportsAuditionScheduling;
      mergedData['derived.isPaidContest'] = selectedContest.isPaid;
      mergedData['derived.allowedTalentSkills'] = getTalentSkillsForContestCategory(selectedContest.contestCategory);
      mergedData['payment.feeAmount'] = selectedContest.registrationFeeNgn || 0;
      mergedData['contest.auditionPreference'] = '';
      mergedData['contest.preferredAuditionCity'] = '';
      mergedData['audition.state'] = '';
      mergedData['audition.city'] = '';
      mergedData['audition.venue'] = '';
      if (selectedContest.contestCategory !== 'stem_innovation') {
        mergedData['contest.schoolEntry'] = false;
      }
      if (!selectedContest.isPaid) {
        mergedData['payment.paymentStatus'] = 'waived';
      } else if (!String(mergedData['payment.paymentStatus'] || '')) {
        mergedData['payment.paymentStatus'] = 'pending';
      }
    }
  }

  const age = deriveAge(mergedData['personal.dateOfBirth']);
  if (age !== null) {
    mergedData['derived.age'] = age;
  }

  // Default authenticated passwords
  if (!String(mergedData['account.password'] ?? '').trim()) {
    mergedData['account.password'] = '__authenticated__';
  }
  if (!String(mergedData['account.confirmPassword'] ?? '').trim()) {
    mergedData['account.confirmPassword'] = '__authenticated__';
  }

  const nextDraft: RegistrationDraft = {
    ...draft,
    formData: mergedData,
    updatedAt: nowIso(),
    currentStep: params.stepKey,
  };

  const steps = buildRegistrationSteps(nextDraft);
  const step = steps.find((item) => item.key === params.stepKey);
  if (!step) {
    throw new Error('Invalid step key.');
  }

  const validation = validateStepData(step, mergedData);
  if (!validation.isValid) {
    return { draft: nextDraft, validation };
  }

  nextDraft.completionPercent = calculateCompletionPercent(steps, mergedData);
  nextDraft.fraudFlags = runBasicFraudChecks(nextDraft);

  // Update in Supabase
  const { error: updateError } = await getSupabase()
    .from('registrations')
    .update({
      form_data: mergedData,
      current_step: params.stepKey,
      completion_percent: nextDraft.completionPercent,
      fraud_flags: nextDraft.fraudFlags,
      updated_at: nowIso(),
    })
    .eq('id', params.applicationId);

  if (updateError) {
    throw new Error(`Failed to save registration step: ${updateError.message}`);
  }

  return { draft: nextDraft, validation };
}

/**
 * Fill an EXISTING draft's blanks from the applicant's account, once.
 *
 * Drafts started before account prefill existed carry no marker and would keep
 * asking for a name and phone the platform already has. This backfills them the
 * first time such a draft is opened.
 *
 * Blanks only: an answer the applicant already typed is never overwritten, and
 * a draft that is no longer editable is left completely alone. Returns the draft
 * unchanged when there is nothing to add, so it is safe to call on every read.
 */
export async function applyAccountPrefill(
  draft: RegistrationDraft,
  prefill: { values: Record<string, unknown>; providedKeys: string[] },
): Promise<RegistrationDraft> {
  if (draft.status !== 'draft') return draft;
  if (Array.isArray(draft.formData?.[ACCOUNT_PROVIDED_KEYS])) return draft;

  const merged = { ...draft.formData };
  const filled: string[] = [];
  for (const key of prefill.providedKeys) {
    const current = merged[key];
    if (current !== undefined && current !== null && String(current).trim() !== '') continue;
    merged[key] = prefill.values[key];
    filled.push(key);
  }
  // Records only what the backfill actually WROTE. A value already sitting in an
  // old draft was typed by the applicant, and marking that as account-supplied
  // would lock their own answer where they can no longer edit it.
  merged[ACCOUNT_PROVIDED_KEYS] = filled;

  const { error } = await getSupabase()
    .from('registrations')
    .update({ form_data: merged, updated_at: nowIso() })
    .eq('id', draft.id);

  // A failed backfill costs the convenience, not the application — the draft is
  // returned with the values applied for this response and retried next read.
  if (error) console.warn('[registration] account prefill backfill failed:', error.message);

  return { ...draft, formData: merged };
}

export async function startRegistrationDraft(params: {
  contestSlug: string;
  userId?: string;
  role?: 'public_user' | 'invited_applicant' | 'staff';
  accountData?: Record<string, unknown>;
  /**
   * Details resolved SERVER-SIDE from the applicant's account, plus the keys
   * they filled. Spread after `accountData` so a client-supplied blob can never
   * pass itself off as account-verified — see `features/registration/account-prefill`.
   */
  accountPrefill?: { values: Record<string, unknown>; providedKeys: string[] };
}) {
  const contest = getRegistrationContestBySlug(params.contestSlug) || resolveContestRegistration(params.contestSlug);
  if (!contest) {
    throw new Error('Contest not found.');
  }

  const contests = listRegistrationContests();
  const reference = makeReference(contest.slug);

  const formData = {
    ...(params.accountData || {}),
    ...(params.accountPrefill?.values || {}),
    [ACCOUNT_PROVIDED_KEYS]: params.accountPrefill?.providedKeys || [],
    'contest.title': contest.title,
    'contest.category': contest.contestCategory,
    'contest.type': contest.contestType,
    'contest.region': contest.auditionStates?.[0] || '',
    'contest.applicantCategory': contest.applicantCategories?.[0] || '',
    'contest.categoryKey': contest.categoryQuestionSet,
    'account.country': 'Nigeria',
    'personal.nationality': 'Nigerian',
    'emergency.country': 'Nigeria',
    'derived.availableContestTitles': contests.map((item) => item.title),
    'derived.auditionStates': contest.auditionStates || [],
    'derived.applicantCategories': contest.applicantCategories || [],
    'derived.legalAdultAge': contest.legalAdultAge,
    'derived.requiresMedical': contest.requiresMedical,
    'derived.requiresBootcampReadiness': contest.requiresBootcampReadiness,
    'derived.supportsVoting': contest.supportsVoting,
    'derived.supportsAuditionScheduling': contest.supportsAuditionScheduling,
    'derived.isPaidContest': contest.isPaid,
    'derived.allowedTalentSkills': getTalentSkillsForContestCategory(contest.contestCategory),
    'derived.formSchema': contest.formSchema || null,
    'payment.feeAmount': contest.registrationFeeNgn || 0,
    'payment.paymentStatus': contest.isPaid ? 'pending' : 'waived',
  };

  const now = nowIso();
  const { data, error } = await getSupabase()
    .from('registrations')
    .insert({
      user_id: params.userId,
      contest_slug: params.contestSlug,
      reference,
      form_data: formData,
      current_step: 'contest_selection',
      completion_percent: 0,
      role: params.role || 'public_user',
      fraud_flags: [],
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create registration: ${error.message}`);
  }

  const draft = rowToDraft(data);

  // Create status event
  await getSupabase().from('registration_status_events').insert({
    registration_id: draft.id,
    new_status: 'draft',
    note: 'Application draft created',
    actor_role: params.role || 'public_user',
    created_at: now,
  });

  return draft;
}

export async function submitRegistrationApplication(applicationId: string) {
  const draft = await getRegistrationDraft(applicationId);
  if (!draft) throw new Error('Application not found.');

  // Check if already submitted
  if (['submitted', 'awaiting_payment', 'under_review'].includes(draft.status)) {
    return { success: true, draft, alreadySubmitted: true };
  }

  const steps = buildRegistrationSteps(draft);
  const validationErrors: Record<string, string> = {};

  for (const step of steps) {
    const stepValidation = validateStepData(step, draft.formData);
    if (!stepValidation.isValid) {
      Object.assign(validationErrors, stepValidation.errors);
    }
  }

  if (Object.keys(validationErrors).length > 0) {
    return { success: false, validationErrors, draft };
  }

  const now = nowIso();
  const nextStatus: ApplicationStatus = draft.formData['payment.paymentStatus'] === 'pending' ? 'awaiting_payment' : 'submitted';

  const { error } = await getSupabase()
    .from('registrations')
    .update({
      status: nextStatus,
      submitted_at: now,
      updated_at: now,
      completion_percent: 100,
    })
    .eq('id', applicationId);

  if (error) {
    throw new Error(`Failed to submit application: ${error.message}`);
  }

  draft.status = nextStatus;
  draft.submittedAt = now;
  draft.completionPercent = 100;

  // Create status event
  await getSupabase().from('registration_status_events').insert({
    registration_id: applicationId,
    old_status: 'draft',
    new_status: nextStatus,
    note: 'Application submitted successfully',
    actor_role: draft.role,
    created_at: now,
  });

  return { success: true, draft, message: `Your application has been submitted. Reference: ${draft.reference}.` };
}

// Payment intents live in public.registration_payment_intents — real
// Postgres, not the in-memory store. They used to delegate to
// registration/store.ts's in-memory Map (a prior fix's comment called this
// "BY DESIGN", reasoning the table wasn't wired up yet), which meant every
// intent vanished on a server restart/redeploy — a verified, successful
// Paystack charge could still leave an application looking unpaid forever
// because the record proving it happened was gone. Fixed: the table already
// existed for exactly this (its own migration says so); this is that move.
//
// applyRegistrationPaymentSuccess had the same bug one level up: it wrote
// "paid" onto the in-memory store.ts draft Map, which getRegistrationDraft
// (above, Postgres-only) never reads — so even a successful verify() call
// never actually marked the real draft as paid. Fixed the same way, via the
// same update-in-place pattern saveRegistrationStep already uses.
export type RegistrationPaymentIntent = {
  id: string;
  applicationId: string;
  amountKobo: number;
  method: 'PAYSTACK';
  paymentReference: string;
  idempotencyKey: string;
  // Matches registration_payment_intents_status_check exactly — 'pending'
  // (the in-memory type's original value) isn't a value the DB constraint
  // allows.
  status: 'initiated' | 'completed' | 'verified' | 'failed';
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
};

function rowToPaymentIntent(row: Record<string, unknown>): RegistrationPaymentIntent {
  return {
    id: row.id as string,
    applicationId: row.application_id as string,
    amountKobo: Number(row.amount_kobo),
    method: 'PAYSTACK',
    paymentReference: row.reference as string,
    idempotencyKey: row.idempotency_key as string,
    status: row.status as RegistrationPaymentIntent['status'],
    failureReason: (row.failure_reason as string | null) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function findRegistrationPaymentIntentByIdempotencyKey(
  idempotencyKey: string,
): Promise<RegistrationPaymentIntent | null> {
  const { data, error } = await getSupabase()
    .from('registration_payment_intents')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) throw new Error(`Failed to look up payment intent: ${error.message}`);
  return data ? rowToPaymentIntent(data) : null;
}

export async function getRegistrationPaymentIntentByReference(
  reference: string,
): Promise<RegistrationPaymentIntent | null> {
  const { data, error } = await getSupabase()
    .from('registration_payment_intents')
    .select('*')
    .eq('reference', reference)
    .maybeSingle();
  if (error) throw new Error(`Failed to look up payment intent: ${error.message}`);
  return data ? rowToPaymentIntent(data) : null;
}

export async function createRegistrationPaymentIntent(input: {
  applicationId: string;
  amountKobo: number;
  paymentReference: string;
  idempotencyKey: string;
}): Promise<RegistrationPaymentIntent> {
  const { data, error } = await getSupabase()
    .from('registration_payment_intents')
    .insert({
      application_id: input.applicationId,
      reference: input.paymentReference,
      amount_kobo: input.amountKobo,
      method: 'PAYSTACK',
      idempotency_key: input.idempotencyKey,
      status: 'initiated',
    })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create payment intent: ${error.message}`);
  return rowToPaymentIntent(data);
}

export async function markRegistrationPaymentIntentStatus(
  id: string,
  status: 'completed' | 'failed',
  failureReason?: string,
): Promise<RegistrationPaymentIntent | null> {
  const { data, error } = await getSupabase()
    .from('registration_payment_intents')
    .update({ status, failure_reason: failureReason ?? null, updated_at: nowIso() })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Failed to update payment intent: ${error.message}`);
  return data ? rowToPaymentIntent(data) : null;
}

// Applies a verified Paystack success onto the draft — the same formData
// shape the (former) mock client wrote, so nothing downstream (submit screen,
// completion %) needs to change.
export async function applyRegistrationPaymentSuccess(
  applicationId: string,
  params: { reference: string; method: 'PAYSTACK' },
): Promise<RegistrationDraft> {
  const draft = await getRegistrationDraft(applicationId);
  if (!draft) throw new Error('Application not found.');

  const mergedData = {
    ...draft.formData,
    'payment.paymentStatus': 'paid',
    'payment.transactionReference': params.reference,
    'payment.method': params.method,
  };
  const updatedAt = nowIso();

  const { error } = await getSupabase()
    .from('registrations')
    .update({ form_data: mergedData, updated_at: updatedAt })
    .eq('id', applicationId);
  if (error) throw new Error(`Failed to record payment success: ${error.message}`);

  return { ...draft, formData: mergedData, updatedAt };
}

export async function listRegistrationApplications(filter: {
  contestSlug?: string;
  status?: ApplicationStatus;
  contestCategory?: string;
  paymentStatus?: string;
  query?: string;
  minAge?: number;
  maxAge?: number;
}) {
  let query = getSupabase().from('registrations').select('*');

  if (filter.contestSlug) {
    query = query.eq('contest_slug', filter.contestSlug);
  }
  if (filter.status) {
    query = query.eq('status', filter.status);
  }
  if (filter.paymentStatus) {
    query = query.eq("form_data->>'payment.paymentStatus'", filter.paymentStatus);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list registrations: ${error.message}`);
  }

  let drafts = (data || []).map(rowToDraft);

  // Filter by category
  if (filter.contestCategory) {
    drafts = drafts.filter((d) => d.formData['contest.category'] === filter.contestCategory);
  }

  // Filter by age
  if (filter.minAge !== undefined || filter.maxAge !== undefined) {
    drafts = drafts.filter((d) => {
      const age = d.formData['derived.age'] as number | undefined;
      if (age === undefined) return true;
      if (filter.minAge !== undefined && age < filter.minAge) return false;
      if (filter.maxAge !== undefined && age > filter.maxAge) return false;
      return true;
    });
  }

  // Filter by query (search in reference or name)
  if (filter.query) {
    const q = filter.query.toLowerCase();
    drafts = drafts.filter(
      (d) =>
        d.reference.toLowerCase().includes(q) ||
        String(d.formData['personal.firstName'] || '').toLowerCase().includes(q) ||
        String(d.formData['personal.lastName'] || '').toLowerCase().includes(q) ||
        String(d.formData['account.email'] || '').toLowerCase().includes(q)
    );
  }

  return drafts;
}

export async function withdrawRegistrationApplication(
  applicationId: string,
  note?: string,
): Promise<RegistrationDraft> {
  const current = await getRegistrationDraft(applicationId);
  if (!current) throw new Error('Application not found.');

  const now = nowIso();
  const { data, error } = await getSupabase()
    .from('registrations')
    .update({ status: 'withdrawn', withdrawn_at: now, updated_at: now })
    .eq('id', applicationId)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to withdraw registration: ${error.message}`);
  }

  await getSupabase().from('registration_status_events').insert({
    registration_id: applicationId,
    old_status: current.status,
    new_status: 'withdrawn',
    note: note || 'Application withdrawn by applicant',
    actor_role: 'public_user',
    created_at: now,
  });

  return rowToDraft(data);
}

/**
 * ADMIN CONSOLIDATION, slice 5 (see docs/adr/ADR-047). This did not exist here
 * before — the admin review/approve/reject/shortlist routes called the
 * in-memory registration/store version instead, which writes to a Map nothing
 * else reads. Every real application lives in the `registrations` table (see
 * startRegistrationDraft/saveRegistrationStep above), so an admin clicking
 * "Approve" updated a map the applicant's real record never saw — the decision
 * looked successful and silently didn't apply. Mirrors withdrawRegistrationApplication's
 * shape immediately above: update the row, then append a
 * registration_status_events row for the audit timeline.
 */
export async function reviewRegistrationApplication(
  applicationId: string,
  input: RegistrationReviewInput,
): Promise<RegistrationDraft> {
  const current = await getRegistrationDraft(applicationId);
  if (!current) throw new Error('Application not found.');

  const now = nowIso();
  const nextFraudFlags = input.fraudFlags || current.fraudFlags;
  const nextFormData = {
    ...current.formData,
    'admin.reviewNote': input.note || '',
    'admin.reviewScore': typeof input.score === 'number' ? input.score : current.formData['admin.reviewScore'],
    'admin.requestedFields': input.requestedFields || current.formData['admin.requestedFields'],
  };

  const { data, error } = await getSupabase()
    .from('registrations')
    .update({
      status: input.status,
      form_data: nextFormData,
      fraud_flags: nextFraudFlags,
      updated_at: now,
    })
    .eq('id', applicationId)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to review registration: ${error.message}`);
  }

  await getSupabase().from('registration_status_events').insert({
    registration_id: applicationId,
    old_status: current.status,
    new_status: input.status,
    note: input.note || 'Admin review action',
    actor_role: 'admin',
    created_at: now,
  });

  return rowToDraft(data);
}

export async function getRegistrationStatusTimeline(
  applicationId: string,
): Promise<RegistrationStatusEvent[]> {
  const { data, error } = await getSupabase()
    .from('registration_status_events')
    .select('*')
    .eq('registration_id', applicationId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch status timeline: ${error.message}`);
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    applicationId: row.registration_id,
    oldStatus: row.old_status ?? undefined,
    newStatus: row.new_status,
    note: row.note ?? undefined,
    createdAt: row.created_at,
    actorRole: row.actor_role,
  }));
}

// Helper: Convert Supabase row to RegistrationDraft
function rowToDraft(row: any): RegistrationDraft {
  return {
    id: row.id,
    reference: row.reference,
    contestSlug: row.contest_slug,
    status: row.status as ApplicationStatus,
    role: row.role,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    completionPercent: row.completion_percent,
    currentStep: row.current_step,
    fraudFlags: row.fraud_flags || [],
    formData: row.form_data || {},
  };
}
