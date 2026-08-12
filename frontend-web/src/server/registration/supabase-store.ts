import { createClient } from '@supabase/supabase-js';
import {
  buildRegistrationSteps,
  calculateCompletionPercent,
  deriveAge,
  runBasicFraudChecks,
  validateStepData,
  getTalentSkillsForContestCategory,
  resolveContestRegistration,
  contestRegistrationCatalog,
  getRegistrationContestBySlug,
} from '@/src/features/registration/config';
import { listRegistrationContests } from '@/src/server/registration/store';
import type {
  ContestRegistrationDefinition,
  ApplicationStatus,
  RegistrationDraft,
  RegistrationStepKey,
  RegistrationStatusEvent,
} from '@/src/features/registration/types';

// Initialize Supabase client (service role for admin operations)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false } }
);

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

  const { data, error } = await supabase
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
  const { error: updateError } = await supabase
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

export async function startRegistrationDraft(params: {
  contestSlug: string;
  userId?: string;
  role?: 'public_user' | 'invited_applicant' | 'staff';
  accountData?: Record<string, unknown>;
}) {
  const contest = getRegistrationContestBySlug(params.contestSlug) || resolveContestRegistration(params.contestSlug);
  if (!contest) {
    throw new Error('Contest not found.');
  }

  const contests = listRegistrationContests();
  const reference = makeReference(contest.slug);

  const formData = {
    ...(params.accountData || {}),
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
  const { data, error } = await supabase
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
  await supabase.from('registration_status_events').insert({
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

  const { error } = await supabase
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
  await supabase.from('registration_status_events').insert({
    registration_id: applicationId,
    old_status: 'draft',
    new_status: nextStatus,
    note: 'Application submitted successfully',
    actor_role: draft.role,
    created_at: now,
  });

  return { success: true, draft, message: `Your application has been submitted. Reference: ${draft.reference}.` };
}

// Payment intent functions (TODO: implement in Supabase)
export async function findRegistrationPaymentIntentByIdempotencyKey(key: string) {
  return null; // Not yet implemented
}

export async function createRegistrationPaymentIntent(params: any) {
  throw new Error('Payment intents not yet implemented in Supabase store');
}

export async function getRegistrationPaymentIntentByReference(ref: string) {
  return null;
}

export async function markRegistrationPaymentIntentStatus(id: string, status: string) {
  // Not yet implemented
}

export async function applyRegistrationPaymentSuccess(intentId: string, userId: string) {
  // Not yet implemented
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
  let query = supabase.from('registrations').select('*');

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
