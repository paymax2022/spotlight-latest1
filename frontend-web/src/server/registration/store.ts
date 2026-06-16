import { randomUUID } from 'crypto';
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
import type {
  ContestRegistrationDefinition,
  ApplicationStatus,
  RegistrationDraft,
  RegistrationListFilter,
  RegistrationReviewInput,
  RegistrationStatusEvent,
  RegistrationStepKey,
} from '@/src/features/registration/types';

interface RegistrationStore {
  drafts: Map<string, RegistrationDraft>;
  statusEvents: Map<string, RegistrationStatusEvent[]>;
  contests: Map<string, ContestRegistrationDefinition>;
}

function getStore(): RegistrationStore {
  const globalKey = '__spotlightContestRegistrationStore';
  const globalObj = globalThis as unknown as Record<string, RegistrationStore | undefined>;
  if (!globalObj[globalKey]) {
    globalObj[globalKey] = {
      drafts: new Map<string, RegistrationDraft>(),
      statusEvents: new Map<string, RegistrationStatusEvent[]>(),
      contests: new Map<string, ContestRegistrationDefinition>(),
    };
  }
  return globalObj[globalKey] as RegistrationStore;
}

function ensureContestStore() {
  const store = getStore();
  if (store.contests.size === 0) {
    for (const contest of contestRegistrationCatalog) {
      store.contests.set(contest.slug, contest);
    }
  }
  return store;
}

function nowIso() {
  return new Date().toISOString();
}

function makeReference(contestSlug: string) {
  const prefix = contestSlug.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase() || 'SPOT';
  const stamp = Date.now().toString().slice(-6);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${stamp}-${suffix}`;
}

function pushStatusEvent(applicationId: string, oldStatus: ApplicationStatus | undefined, newStatus: ApplicationStatus, note: string | undefined, actorRole: RegistrationStatusEvent['actorRole']) {
  const store = getStore();
  const event: RegistrationStatusEvent = {
    id: randomUUID(),
    applicationId,
    oldStatus,
    newStatus,
    note,
    createdAt: nowIso(),
    actorRole,
  };
  const existing = store.statusEvents.get(applicationId) || [];
  existing.push(event);
  store.statusEvents.set(applicationId, existing);
}

export function listRegistrationContests() {
  const store = ensureContestStore();
  return Array.from(store.contests.values()).sort((a, b) => a.title.localeCompare(b.title));
}

export function getRegistrationContestBySlug(slug: string) {
  if (!slug) return null;
  const store = ensureContestStore();
  return store.contests.get(slug) || null;
}

export function createRegistrationContest(input: ContestRegistrationDefinition) {
  const store = ensureContestStore();
  const slug = String(input.slug || '').trim();
  const title = String(input.title || '').trim();

  if (!slug) throw new Error('Contest slug is required.');
  if (!title) throw new Error('Contest title is required.');
  if (store.contests.has(slug)) {
    throw new Error('A contest with this slug already exists.');
  }

  const duplicateTitle = Array.from(store.contests.values()).some((contest) => contest.title.toLowerCase() === title.toLowerCase());
  if (duplicateTitle) {
    throw new Error('A contest with this title already exists.');
  }

  const normalized: ContestRegistrationDefinition = {
    ...input,
    slug,
    title,
    registrationFeeNgn: input.isPaid ? Number(input.registrationFeeNgn || 0) : 0,
    auditionStates: Array.isArray(input.auditionStates) ? input.auditionStates : [],
    applicantCategories: Array.isArray(input.applicantCategories) ? input.applicantCategories : [],
  };

  store.contests.set(normalized.slug, normalized);
  return normalized;
}

export function updateRegistrationContest(slug: string, input: Partial<ContestRegistrationDefinition>) {
  const store = ensureContestStore();
  const current = store.contests.get(slug);
  if (!current) {
    throw new Error('Contest not found.');
  }

  const nextSlug = String(input.slug || current.slug).trim();
  const nextTitle = String(input.title || current.title).trim();

  if (!nextSlug) throw new Error('Contest slug is required.');
  if (!nextTitle) throw new Error('Contest title is required.');

  if (nextSlug !== slug && store.contests.has(nextSlug)) {
    throw new Error('A contest with this slug already exists.');
  }

  const duplicateTitle = Array.from(store.contests.values()).some(
    (contest) => contest.slug !== slug && contest.title.toLowerCase() === nextTitle.toLowerCase(),
  );
  if (duplicateTitle) {
    throw new Error('A contest with this title already exists.');
  }

  const updated: ContestRegistrationDefinition = {
    ...current,
    ...input,
    slug: nextSlug,
    title: nextTitle,
    registrationFeeNgn: input.isPaid === false ? 0 : Number(input.registrationFeeNgn ?? current.registrationFeeNgn ?? 0),
    auditionStates: Array.isArray(input.auditionStates) ? input.auditionStates : current.auditionStates || [],
    applicantCategories: Array.isArray(input.applicantCategories)
      ? input.applicantCategories
      : current.applicantCategories || [],
  };

  if (nextSlug !== slug) {
    store.contests.delete(slug);
  }
  store.contests.set(updated.slug, updated);
  return updated;
}

export function deleteRegistrationContest(slug: string) {
  const store = ensureContestStore();
  if (!store.contests.has(slug)) {
    throw new Error('Contest not found.');
  }

  store.contests.delete(slug);
}

export function startRegistrationDraft(params: {
  contestSlug: string;
  userId?: string;
  role?: RegistrationDraft['role'];
  accountData?: Record<string, unknown>;
}) {
  const contest = getRegistrationContestBySlug(params.contestSlug) || resolveContestRegistration(params.contestSlug);
  if (!contest) {
    throw new Error('Contest not found.');
  }

  const contests = listRegistrationContests();

  const id = randomUUID();
  const now = nowIso();
  const draft: RegistrationDraft = {
    id,
    reference: makeReference(contest.slug),
    contestSlug: contest.slug,
    status: 'draft',
    role: params.role || 'public_user',
    userId: params.userId,
    createdAt: now,
    updatedAt: now,
    formData: {
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
      'payment.feeAmount': contest.registrationFeeNgn || 0,
      'payment.paymentStatus': contest.isPaid ? 'pending' : 'waived',
    },
    completionPercent: 0,
    currentStep: 'account_gate',
    fraudFlags: [],
  };

  const store = getStore();
  store.drafts.set(draft.id, draft);
  pushStatusEvent(draft.id, undefined, 'draft', 'Application draft created', 'public_user');
  return draft;
}

export function getRegistrationDraft(applicationId: string) {
  const store = getStore();
  return store.drafts.get(applicationId) || null;
}

export function saveRegistrationStep(params: {
  applicationId: string;
  stepKey: RegistrationStepKey;
  values: Record<string, unknown>;
}) {
  const store = getStore();
  const draft = store.drafts.get(params.applicationId);
  if (!draft) throw new Error('Application not found.');

  const mergedData = {
    ...draft.formData,
    ...params.values,
  };

  // Contest identity is fixed when the draft is created from an /apply/:slug route.
  // Do not allow clients to switch contests by modifying form payload values.
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
    return {
      draft: nextDraft,
      validation,
    };
  }

  nextDraft.completionPercent = calculateCompletionPercent(steps, mergedData);
  nextDraft.fraudFlags = runBasicFraudChecks(nextDraft);

  store.drafts.set(nextDraft.id, nextDraft);

  return {
    draft: nextDraft,
    validation,
  };
}

export function submitRegistrationApplication(applicationId: string) {
  const store = getStore();
  const draft = store.drafts.get(applicationId);
  if (!draft) throw new Error('Application not found.');

  if (
    [
      'submitted',
      'awaiting_payment',
      'under_review',
      'more_information_requested',
      'shortlisted',
      'callback_invited',
      'approved',
      'rejected',
      'waitlisted',
      'disqualified',
      'audition_scheduled',
      'selected_for_bootcamp',
      'selected_for_public_voting',
      'eliminated',
      'winner',
    ].includes(draft.status)
  ) {
    return {
      success: true,
      draft,
      alreadySubmitted: true,
    };
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
    return {
      success: false,
      validationErrors,
      draft,
    };
  }

  const oldStatus = draft.status;
  const paymentStatus = String(draft.formData['payment.paymentStatus'] || '');
  const nextStatus: ApplicationStatus = paymentStatus === 'pending' ? 'awaiting_payment' : 'submitted';

  const submitted: RegistrationDraft = {
    ...draft,
    status: nextStatus,
    submittedAt: nowIso(),
    updatedAt: nowIso(),
    completionPercent: 100,
    fraudFlags: runBasicFraudChecks(draft),
  };

  store.drafts.set(applicationId, submitted);
  pushStatusEvent(applicationId, oldStatus, nextStatus, 'Application submitted successfully', 'public_user');

  return {
    success: true,
    draft: submitted,
  };
}

export function withdrawRegistrationApplication(applicationId: string, note?: string) {
  const store = getStore();
  const draft = store.drafts.get(applicationId);
  if (!draft) throw new Error('Application not found.');

  const oldStatus = draft.status;
  const updated: RegistrationDraft = {
    ...draft,
    status: 'withdrawn',
    updatedAt: nowIso(),
  };
  store.drafts.set(applicationId, updated);
  pushStatusEvent(applicationId, oldStatus, 'withdrawn', note || 'Application withdrawn by applicant', 'public_user');
  return updated;
}

export function getRegistrationStatusTimeline(applicationId: string) {
  return getStore().statusEvents.get(applicationId) || [];
}

export function listRegistrationApplications(filter: RegistrationListFilter = {}) {
  const drafts = Array.from(getStore().drafts.values());

  return drafts.filter((draft) => {
    if (filter.contestSlug && draft.contestSlug !== filter.contestSlug) return false;
    if (filter.status && draft.status !== filter.status) return false;
    if (filter.contestCategory) {
      const category = String(draft.formData['contest.category'] || '');
      if (category !== filter.contestCategory) return false;
    }
    if (filter.paymentStatus) {
      const paymentStatus = String(draft.formData['payment.paymentStatus'] || '');
      if (paymentStatus !== filter.paymentStatus) return false;
    }
    if (typeof filter.minAge === 'number') {
      const age = Number(draft.formData['derived.age'] || 0);
      if (!age || age < filter.minAge) return false;
    }
    if (typeof filter.maxAge === 'number') {
      const age = Number(draft.formData['derived.age'] || 0);
      if (!age || age > filter.maxAge) return false;
    }
    if (filter.query) {
      const q = filter.query.toLowerCase();
      const ref = draft.reference.toLowerCase();
      const name = String(draft.formData['personal.firstName'] || draft.formData['account.fullName'] || '').toLowerCase();
      const email = String(draft.formData['personal.email'] || draft.formData['account.email'] || '').toLowerCase();
      if (!ref.includes(q) && !name.includes(q) && !email.includes(q)) return false;
    }

    return true;
  });
}

export function reviewRegistrationApplication(applicationId: string, input: RegistrationReviewInput) {
  const store = getStore();
  const draft = store.drafts.get(applicationId);
  if (!draft) throw new Error('Application not found.');

  const oldStatus = draft.status;
  const next: RegistrationDraft = {
    ...draft,
    status: input.status,
    updatedAt: nowIso(),
    fraudFlags: input.fraudFlags || draft.fraudFlags,
    formData: {
      ...draft.formData,
      'admin.reviewNote': input.note || '',
      'admin.reviewScore': typeof input.score === 'number' ? input.score : draft.formData['admin.reviewScore'],
      'admin.requestedFields': input.requestedFields || draft.formData['admin.requestedFields'],
    },
  };

  store.drafts.set(applicationId, next);
  pushStatusEvent(applicationId, oldStatus, input.status, input.note, 'admin');

  return next;
}
