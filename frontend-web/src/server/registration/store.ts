import { randomUUID, createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
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
import type {
  ContestRegistrationDefinition,
  ApplicationStatus,
  RegistrationDraft,
  RegistrationListFilter,
  RegistrationReviewInput,
  RegistrationStatusEvent,
  RegistrationStepKey,
} from '@/src/features/registration/types';

// A registration fee charge in flight/settled against the real Paystack
// gateway (test mode). Kept in the same process-global store as everything
// else here — see the payment-gateway note at the bottom of this file for why
// this can't be a separate real-Postgres table while the parent draft lives
// only in this in-memory store.
export interface RegistrationPaymentIntent {
  id: string;
  applicationId: string;
  userId?: string;
  amountKobo: number;
  method: 'PAYSTACK';
  paymentReference: string;
  idempotencyKey: string;
  status: 'pending' | 'completed' | 'failed';
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

interface RegistrationStore {
  drafts: Map<string, RegistrationDraft>;
  statusEvents: Map<string, RegistrationStatusEvent[]>;
  contests: Map<string, ContestRegistrationDefinition>;
  paymentIntentsByIdempotencyKey: Map<string, RegistrationPaymentIntent>;
  paymentIntentsByReference: Map<string, RegistrationPaymentIntent>;
}

// ── Disk persistence ─────────────────────────────────────────────────────────
//
// This store lives in-process (on globalThis). That survives Next.js HMR but NOT
// a full dev-server restart — which would silently drop every in-progress draft
// and make the wizard fail with "Couldn't load application". Until drafts move
// to Supabase, we mirror the store to a small JSON file so a restart doesn't lose
// applications. Best-effort: any FS error is ignored (falls back to memory-only).
// Disabled under tests so specs don't read/write a shared file.
//
// IMPORTANT: the file MUST live outside the project directory. Writing it under
// the repo (e.g. cwd) makes the Next.js dev file-watcher recompile on every
// mutation — a reload loop that resets this in-memory store and breaks the
// wizard mid-use. We keep it in the OS temp dir, namespaced by a hash of cwd so
// separate checkouts don't collide.
const STORE_PERSIST_ENABLED = process.env.NODE_ENV !== 'test';
const STORE_FILE =
  process.env.REGISTRATION_STORE_FILE ||
  path.join(os.tmpdir(), `spotlight-registration-store-${createHash('sha1').update(process.cwd()).digest('hex').slice(0, 8)}.json`);

interface SerializedStore {
  drafts: [string, RegistrationDraft][];
  statusEvents: [string, RegistrationStatusEvent[]][];
  contests: [string, ContestRegistrationDefinition][];
  paymentIntents: RegistrationPaymentIntent[];
}

function emptyStore(): RegistrationStore {
  return {
    drafts: new Map<string, RegistrationDraft>(),
    statusEvents: new Map<string, RegistrationStatusEvent[]>(),
    contests: new Map<string, ContestRegistrationDefinition>(),
    paymentIntentsByIdempotencyKey: new Map<string, RegistrationPaymentIntent>(),
    paymentIntentsByReference: new Map<string, RegistrationPaymentIntent>(),
  };
}

function loadStoreFromDisk(): RegistrationStore | null {
  if (!STORE_PERSIST_ENABLED) return null;
  try {
    const data = JSON.parse(readFileSync(STORE_FILE, 'utf8')) as SerializedStore;
    const store = emptyStore();
    for (const [k, v] of data.drafts || []) store.drafts.set(k, v);
    for (const [k, v] of data.statusEvents || []) store.statusEvents.set(k, v);
    for (const [k, v] of data.contests || []) store.contests.set(k, v);
    for (const intent of data.paymentIntents || []) {
      store.paymentIntentsByIdempotencyKey.set(intent.idempotencyKey, intent);
      store.paymentIntentsByReference.set(intent.paymentReference, intent);
    }
    return store;
  } catch {
    return null;
  }
}

// Persist the current store to disk. Called after every mutation. Best-effort.
function persistStore() {
  if (!STORE_PERSIST_ENABLED) return;
  try {
    const store = getStore();
    const serialized: SerializedStore = {
      drafts: Array.from(store.drafts.entries()),
      statusEvents: Array.from(store.statusEvents.entries()),
      contests: Array.from(store.contests.entries()),
      paymentIntents: Array.from(store.paymentIntentsByIdempotencyKey.values()),
    };
    writeFileSync(STORE_FILE, JSON.stringify(serialized), 'utf8');
  } catch {
    /* ignore — memory remains the source of truth this session */
  }
}

function getStore(): RegistrationStore {
  const globalKey = '__spotlightContestRegistrationStore';
  const globalObj = globalThis as unknown as Record<string, RegistrationStore | undefined>;
  if (!globalObj[globalKey]) {
    globalObj[globalKey] = loadStoreFromDisk() ?? emptyStore();
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
  persistStore();
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
  persistStore();
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
  persistStore();
  return updated;
}

export function deleteRegistrationContest(slug: string) {
  const store = ensureContestStore();
  if (!store.contests.has(slug)) {
    throw new Error('Contest not found.');
  }

  store.contests.delete(slug);
  persistStore();
}

export function startRegistrationDraft(params: {
  contestSlug: string;
  userId?: string;
  role?: RegistrationDraft['role'];
  accountData?: Record<string, unknown>;
  /** Account-resolved details; see the same param on the Supabase store. */
  accountPrefill?: { values: Record<string, unknown>; providedKeys: string[] };
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
    },
    completionPercent: 0,
    currentStep: 'contest_selection',
    fraudFlags: [],
  };

  const store = getStore();
  store.drafts.set(draft.id, draft);
  pushStatusEvent(draft.id, undefined, 'draft', 'Application draft created', 'public_user');
  return draft;
}

export function getRegistrationDraft(applicationId: string) {
  if (!applicationId || typeof applicationId !== 'string') {
    throw new Error('Invalid application ID');
  }
  const store = getStore();
  const draft = store.drafts.get(applicationId);
  if (!draft) {
    console.warn('[registration/store] draft not found for ID:', applicationId, 'available IDs:', Array.from(store.drafts.keys()));
  }
  return draft || null;
}

export function saveRegistrationStep(params: {
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

  const store = getStore();
  const draft = store.drafts.get(params.applicationId);
  if (!draft) {
    console.warn('[registration/store] saveRegistrationStep: draft not found for ID:', params.applicationId);
    throw new Error('Application not found.');
  }

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

  // Account credentials are established by the app's auth (you must log in before
  // applying — the mobile client doesn't even render password fields), so the
  // account_gate step's required `password`/`confirmPassword` inputs are never
  // collected in the wizard. Mirror the web wizard's HIDDEN_AUTH_FIELDS hydration
  // and default them to the '__authenticated__' sentinel (>=8 chars, equal in
  // both) so an authenticated applicant validates instead of being blocked on
  // invisible, unfillable password fields. Only defaults when empty.
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
    return {
      draft: nextDraft,
      validation,
    };
  }

  nextDraft.completionPercent = calculateCompletionPercent(steps, mergedData);
  nextDraft.fraudFlags = runBasicFraudChecks(nextDraft);

  store.drafts.set(nextDraft.id, nextDraft);
  persistStore();

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

// ── Payment (Paystack, real gateway — currently configured in test mode) ────
//
// This used to be entirely client-side mock data, including a fabricated
// `https://checkout.paystack.com/mock?ref=...` authorization URL — a REAL
// Paystack domain with a reference Paystack's servers never issued, so
// opening it always landed on Paystack's own "could not start this
// transaction" error. Registration fees now go through the same
// `initializePaystackPayment`/`verifyPaystackPayment` gateway helper the
// utility/bills module already uses successfully
// (`src/server/voting/payment/paystack.ts`) — see
// `app/api/registration/applications/[id]/payment/{initiate,verify}/route.ts`.
//
// The intent record below is this module's replay-safety + audit trail
// (Idempotency-Key -> intent, amount pinned server-side at initiate time, one
// successful verify per reference) — it does not require a durable Postgres
// table itself because the parent `RegistrationDraft` it belongs to isn't one
// either yet. If/when registration drafts move to Supabase, this should move
// with them (mirroring `utility_paystack_intents`) rather than staying
// in-memory on its own.

export function findRegistrationPaymentIntentByIdempotencyKey(idempotencyKey: string) {
  return getStore().paymentIntentsByIdempotencyKey.get(idempotencyKey) || null;
}

export function getRegistrationPaymentIntentByReference(reference: string) {
  return getStore().paymentIntentsByReference.get(reference) || null;
}

export function createRegistrationPaymentIntent(input: {
  applicationId: string;
  userId?: string;
  amountKobo: number;
  paymentReference: string;
  idempotencyKey: string;
}): RegistrationPaymentIntent {
  const store = getStore();
  const intent: RegistrationPaymentIntent = {
    id: randomUUID(),
    applicationId: input.applicationId,
    userId: input.userId,
    amountKobo: input.amountKobo,
    method: 'PAYSTACK',
    paymentReference: input.paymentReference,
    idempotencyKey: input.idempotencyKey,
    status: 'pending',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.paymentIntentsByIdempotencyKey.set(input.idempotencyKey, intent);
  store.paymentIntentsByReference.set(input.paymentReference, intent);
  persistStore();
  return intent;
}

export function markRegistrationPaymentIntentStatus(
  id: string,
  status: 'completed' | 'failed',
  failureReason?: string,
): RegistrationPaymentIntent | null {
  const store = getStore();
  for (const intent of store.paymentIntentsByIdempotencyKey.values()) {
    if (intent.id !== id) continue;
    const updated: RegistrationPaymentIntent = { ...intent, status, failureReason, updatedAt: nowIso() };
    store.paymentIntentsByIdempotencyKey.set(updated.idempotencyKey, updated);
    store.paymentIntentsByReference.set(updated.paymentReference, updated);
    persistStore();
    return updated;
  }
  return null;
}

// Applies a verified Paystack success onto the draft — the same formData
// shape the (former) mock client wrote, so nothing downstream (submit screen,
// completion %) needs to change.
export function applyRegistrationPaymentSuccess(
  applicationId: string,
  params: { reference: string; method: 'PAYSTACK' },
): RegistrationDraft {
  const store = getStore();
  const draft = store.drafts.get(applicationId);
  if (!draft) throw new Error('Application not found.');

  const updated: RegistrationDraft = {
    ...draft,
    formData: {
      ...draft.formData,
      'payment.paymentStatus': 'paid',
      'payment.transactionReference': params.reference,
      'payment.method': params.method,
    },
    updatedAt: nowIso(),
  };
  store.drafts.set(applicationId, updated);
  persistStore();
  return updated;
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
