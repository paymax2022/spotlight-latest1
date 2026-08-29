// ── Registration — typed API layer the screens code against ──────────────────
// Mock-flagged (REGISTRATION_USE_MOCK). Flip with
// EXPO_PUBLIC_REGISTRATION_USE_MOCK=false to hit the Next.js web app:
//   GET  /api/registration/contests
//   GET|POST /api/registration/applications
//   GET  /api/registration/applications/{id}
//   PATCH /api/registration/applications/{id}        (save step answers)
//   POST /api/registration/applications/{id}/submit
//   GET  /api/registration/applications/{id}/status
//   POST /api/registration/applications/{id}/withdraw
//   POST /api/registration/uploads                   (multipart file)

import {
  REGISTRATION_USE_MOCK, waitMock, regGet, regPost, regPatch, regUpload,
} from './registration.client';
import { MOCK_CONTESTS, buildMockSteps } from './registration.mock';
import type {
  ContestRegistrationDefinition,
  RegistrationDraft,
  RegistrationStep,
  RegistrationStepKey,
  RegistrationStatusEvent,
  ApplicationStatus,
  ContestsResponse,
  ApplicationsListResponse,
  DraftResponse,
  SaveStepResponse,
  SubmitResponse,
  StatusResponse,
  UploadResponse,
  PickedUpload,
  UploadedFileValue,
  RegistrationPaymentMethod,
  InitiateRegistrationPaymentResponse,
  VerifyRegistrationPaymentResponse,
} from '../types/registration.types';

const REG_BASE = '/api/registration';

// ── Mock draft store ──────────────────────────────────────────────────────────
// BUG FIX: this used to be a plain module-scoped `Map`, which only lives as
// long as the current JS runtime. On Expo web that runtime is thrown away on
// every full page reload (browser refresh, or opening a `/registration/{id}/…`
// URL directly/from a bookmark — exactly the `mock-<timestamp>` id shape this
// module mints). The submit screen (`app/registration/[id]/submit.tsx`) calls
// `useDraft(id)` -> `getDraft(id)`, which threw "Application not found" the
// moment the id wasn't in that fresh, empty Map — so "submit" looked broken
// even though nothing was wrong with the submit logic itself. Bills-service
// payment doesn't have this failure mode because it reads/writes real Supabase
// rows (`src/api/transactions.api.ts`), not client-only mock state.
//
// Fix: persist the mock store to localStorage on web (guarded — no-op on
// native/SSR where `window` doesn't exist) so a reload rehydrates the same
// drafts instead of losing them. This only affects REGISTRATION_USE_MOCK
// (dev-default) behaviour; the LIVE branch below is untouched.
type MockDraftEntry = { draft: RegistrationDraft; steps: RegistrationStep[]; timeline: RegistrationStatusEvent[] };
const MOCK_STORE_KEY = 'spotlight.registration.mockDrafts.v1';

function hasWebStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function loadPersistedDrafts(): Map<string, MockDraftEntry> {
  if (!hasWebStorage()) return new Map();
  try {
    const raw = window.localStorage.getItem(MOCK_STORE_KEY);
    if (!raw) return new Map();
    return new Map(JSON.parse(raw) as Array<[string, MockDraftEntry]>);
  } catch {
    return new Map();
  }
}

function saveMockDrafts(): void {
  if (!hasWebStorage()) return;
  try {
    window.localStorage.setItem(MOCK_STORE_KEY, JSON.stringify(Array.from(mockDrafts.entries())));
  } catch {
    // Best-effort (e.g. storage quota, private browsing) — falls back to the
    // pre-fix in-memory-only behaviour rather than throwing.
  }
}

// In-memory mock draft store (module-scoped), hydrated from localStorage on
// web at module load so it survives a page reload — see fix note above.
const mockDrafts = loadPersistedDrafts();

function mockRef(slug: string) {
  const prefix = slug.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase() || 'SPOT';
  return `${prefix}-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function recomputeCompletion(steps: RegistrationStep[], formData: Record<string, unknown>): number {
  const required = steps.flatMap((s) => s.fields).filter((f) => f.required && !f.readOnly);
  if (required.length === 0) return 100;
  const filled = required.filter((f) => {
    const v = formData[f.key];
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'boolean') return v === true;
    return v !== undefined && v !== null && String(v).trim() !== '';
  });
  return Math.round((filled.length / required.length) * 100);
}

// ── Contests ──────────────────────────────────────────────────────────────────

export async function listContests(): Promise<ContestRegistrationDefinition[]> {
  if (REGISTRATION_USE_MOCK) return waitMock(MOCK_CONTESTS);
  const res = await regGet<ContestsResponse>(`${REG_BASE}/contests`);
  return res.contests ?? [];
}

// ── Applications ────────────────────────────────────────────────────────────

export async function listApplications(): Promise<RegistrationDraft[]> {
  if (REGISTRATION_USE_MOCK) {
    return waitMock(Array.from(mockDrafts.values()).map((d) => d.draft));
  }
  const res = await regGet<ApplicationsListResponse>(`${REG_BASE}/applications`);
  return res.applications ?? [];
}

export async function startDraft(contestSlug: string): Promise<RegistrationDraft> {
  if (REGISTRATION_USE_MOCK) {
    const contest = MOCK_CONTESTS.find((c) => c.slug === contestSlug) ?? MOCK_CONTESTS[0];
    const id = `mock-${Date.now()}`;
    const now = new Date().toISOString();
    const steps = buildMockSteps(contest.title, contest.registrationFeeNgn ?? 0);
    const draft: RegistrationDraft = {
      id,
      reference: mockRef(contest.slug),
      contestSlug: contest.slug,
      status: 'draft',
      role: 'public_user',
      createdAt: now,
      updatedAt: now,
      completionPercent: 0,
      currentStep: 'contest_selection',
      fraudFlags: [],
      formData: {
        'contest.title': contest.title,
        'contest.category': contest.contestCategory,
        'payment.feeAmount': contest.registrationFeeNgn ?? 0,
        'payment.paymentStatus': contest.isPaid ? 'pending' : 'waived',
      },
    };
    mockDrafts.set(id, { draft, steps, timeline: [{ id: `${id}-ev0`, applicationId: id, newStatus: 'draft', note: 'Application draft created', createdAt: now, actorRole: 'public_user' }] });
    saveMockDrafts();
    return waitMock(draft);
  }
  const res = await regPost<DraftResponse>(`${REG_BASE}/applications`, { contestSlug });
  return res.draft;
}

export async function getDraft(id: string): Promise<{ draft: RegistrationDraft; steps: RegistrationStep[] }> {
  if (REGISTRATION_USE_MOCK) {
    const entry = mockDrafts.get(id);
    if (!entry) throw new Error('Application not found');
    return waitMock({ draft: entry.draft, steps: entry.steps });
  }
  const res = await regGet<DraftResponse>(`${REG_BASE}/applications/${id}`);
  return { draft: res.draft, steps: res.steps ?? [] };
}

// Save one step's answers. Returns the updated draft, recomputed schema, and
// any server-side validation errors (validation.isValid === false → blocked).
export async function saveStep(params: {
  id: string;
  stepKey: RegistrationStepKey;
  values: Record<string, unknown>;
}): Promise<SaveStepResponse> {
  if (REGISTRATION_USE_MOCK) {
    const entry = mockDrafts.get(params.id);
    if (!entry) throw new Error('Application not found');
    const formData = { ...entry.draft.formData, ...params.values };
    const step = entry.steps.find((s) => s.key === params.stepKey);
    const errors: Record<string, string> = {};
    if (step) {
      for (const f of step.fields) {
        if (!f.required || f.readOnly) continue;
        const v = formData[f.key];
        const empty = Array.isArray(v) ? v.length === 0 : typeof v === 'boolean' ? v !== true : v === undefined || v === null || String(v).trim() === '';
        if (empty) errors[f.key] = `${f.label} is required.`;
      }
    }
    const isValid = Object.keys(errors).length === 0;
    const draft: RegistrationDraft = {
      ...entry.draft,
      formData,
      currentStep: params.stepKey,
      updatedAt: new Date().toISOString(),
      completionPercent: isValid ? recomputeCompletion(entry.steps, formData) : entry.draft.completionPercent,
    };
    mockDrafts.set(params.id, { ...entry, draft });
    saveMockDrafts();
    return waitMock({ success: true, draft, steps: entry.steps, validation: { isValid, errors } });
  }
  return regPatch<SaveStepResponse>(`${REG_BASE}/applications/${params.id}`, {
    stepKey: params.stepKey,
    values: params.values,
  });
}

export async function submitApplication(id: string): Promise<SubmitResponse> {
  if (REGISTRATION_USE_MOCK) {
    const entry = mockDrafts.get(id);
    if (!entry) throw new Error('Application not found');
    const paymentStatus = String(entry.draft.formData['payment.paymentStatus'] || '');
    const nextStatus: ApplicationStatus = paymentStatus === 'pending' ? 'awaiting_payment' : 'submitted';
    const now = new Date().toISOString();
    const draft: RegistrationDraft = { ...entry.draft, status: nextStatus, submittedAt: now, updatedAt: now, completionPercent: 100 };
    entry.timeline.push({ id: `${id}-ev${entry.timeline.length}`, applicationId: id, oldStatus: 'draft', newStatus: nextStatus, note: 'Application submitted successfully', createdAt: now, actorRole: 'public_user' });
    mockDrafts.set(id, { ...entry, draft });
    saveMockDrafts();
    return waitMock({ success: true, draft, message: `Your Spotlight application has been submitted. Reference ${draft.reference}.` });
  }
  return regPost<SubmitResponse>(`${REG_BASE}/applications/${id}/submit`);
}

export async function getStatus(id: string): Promise<{ draft: RegistrationDraft; timeline: RegistrationStatusEvent[] }> {
  if (REGISTRATION_USE_MOCK) {
    const entry = mockDrafts.get(id);
    if (!entry) throw new Error('Application not found');
    return waitMock({ draft: entry.draft, timeline: entry.timeline });
  }
  const res = await regGet<StatusResponse>(`${REG_BASE}/applications/${id}/status`);
  return { draft: res.draft, timeline: res.timeline ?? [] };
}

export async function withdrawApplication(id: string, note?: string): Promise<RegistrationDraft> {
  if (REGISTRATION_USE_MOCK) {
    const entry = mockDrafts.get(id);
    if (!entry) throw new Error('Application not found');
    const now = new Date().toISOString();
    const draft: RegistrationDraft = { ...entry.draft, status: 'withdrawn', updatedAt: now };
    entry.timeline.push({ id: `${id}-ev${entry.timeline.length}`, applicationId: id, oldStatus: entry.draft.status, newStatus: 'withdrawn', note: note || 'Application withdrawn by applicant', createdAt: now, actorRole: 'public_user' });
    mockDrafts.set(id, { ...entry, draft });
    saveMockDrafts();
    return waitMock(draft);
  }
  const res = await regPost<DraftResponse>(`${REG_BASE}/applications/${id}/withdraw`, { note });
  return res.draft;
}

// ── Payment ───────────────────────────────────────────────────────────────────

export async function initiateRegistrationPayment(params: {
  id: string;
  amountKobo: number;
  method: RegistrationPaymentMethod;
  email: string;
  name: string;
  /** Threaded through as the Idempotency-Key header on the live path — a
   *  retried/double-submitted "Pay" tap must not open two Paystack
   *  transactions for the same fee. Required for LIVE; unused in MOCK. */
  idempotencyKey?: string;
}): Promise<InitiateRegistrationPaymentResponse> {
  if (REGISTRATION_USE_MOCK) {
    const entry = mockDrafts.get(params.id);
    if (!entry) throw new Error('Application not found');
    const reference = `SPT-REG-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const transactionId = `tid-${Date.now()}`;

    if (params.method === 'WALLET') {
      // Wallet debits immediately — mark paid and record reference in formData.
      const formData = {
        ...entry.draft.formData,
        'payment.paymentStatus':       'paid',
        'payment.transactionReference': reference,
        'payment.method':              'Wallet',
      };
      mockDrafts.set(params.id, { ...entry, draft: { ...entry.draft, formData, updatedAt: new Date().toISOString() } });
      saveMockDrafts();
      return waitMock({ success: true, transactionId, reference, status: 'completed' }, 800);
    }

    // Paystack (mock): no authorizationUrl. This used to fabricate
    // `https://checkout.paystack.com/mock?ref=...` — a REAL Paystack domain
    // with a reference Paystack's servers never actually issued, so opening
    // it always landed on Paystack's own "We could not start this
    // transaction" error page. There is no real hosted-checkout step to
    // simulate: the payment-processing screen already polls
    // verifyRegistrationPayment on its own timer and that mock settles to
    // SUCCESSFUL without any external redirect (mirrors the WALLET branch
    // above, which never had a URL either). The caller
    // (`app/registration/[id]/payment.tsx`) only calls `Linking.openURL`
    // `if (result.authorizationUrl)`, so simply omitting the field here is
    // enough to skip the broken redirect — the LIVE branch below (real
    // backend-issued Paystack URL) is unaffected.
    return waitMock({
      success: true,
      transactionId,
      reference,
      status: 'initiated',
    }, 600);
  }

  return regPost<InitiateRegistrationPaymentResponse>(
    `${REG_BASE}/applications/${params.id}/payment/initiate`,
    { amountKobo: params.amountKobo, method: params.method, email: params.email, name: params.name },
    params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : undefined,
  );
}

export async function verifyRegistrationPayment(params: {
  id: string;
  transactionId: string;
  reference: string;
}): Promise<VerifyRegistrationPaymentResponse> {
  if (REGISTRATION_USE_MOCK) {
    const entry = mockDrafts.get(params.id);
    if (!entry) throw new Error('Application not found');

    // Simulate Paystack verification: first call returns PENDING, second SUCCESSFUL.
    const alreadyPaid = entry.draft.formData['payment.paymentStatus'] === 'paid';
    if (alreadyPaid) {
      return waitMock({ success: true, status: 'SUCCESSFUL', reference: params.reference }, 500);
    }
    // Mark paid on first verification attempt (mock Paystack settled quickly).
    const formData = {
      ...entry.draft.formData,
      'payment.paymentStatus':       'paid',
      'payment.transactionReference': params.reference,
      'payment.method':              'Card',
    };
    mockDrafts.set(params.id, { ...entry, draft: { ...entry.draft, formData, updatedAt: new Date().toISOString() } });
    saveMockDrafts();
    return waitMock({ success: true, status: 'SUCCESSFUL', reference: params.reference }, 1500);
  }

  const qs = `transactionId=${encodeURIComponent(params.transactionId)}&reference=${encodeURIComponent(params.reference)}`;
  return regGet<VerifyRegistrationPaymentResponse>(
    `${REG_BASE}/applications/${params.id}/payment/verify?${qs}`,
  );
}

// ── Uploads ───────────────────────────────────────────────────────────────────

export async function uploadFile(file: PickedUpload): Promise<UploadedFileValue> {
  if (REGISTRATION_USE_MOCK) {
    return waitMock({ previewUrl: file.uri, fileName: file.name }, 500);
  }
  const res = await regUpload<UploadResponse>(`${REG_BASE}/uploads`, file);
  return { previewUrl: res.upload.previewUrl, fileName: res.upload.fileName, storageKey: res.upload.storageKey };
}
