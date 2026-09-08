// ── Paymax Invest · Onboarding — API wrapper ─────────────────────────────────
// Typed data layer the onboarding screens code against (Backend role owns this).
// Mirrors crypto.api.ts: mock-flagged. Flip EXPO_PUBLIC_ONBOARDING_USE_MOCK=false
// once the real Paymax endpoints land. Maps entirely under /api/v1/invest/*
// (backend/internal/invest/routes.go) — suitability lives at
// /api/v1/invest/suitability/*, not a top-level /api/v1/suitability/*.

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import {
  MOCK_AGREEMENTS,
  buildEligibility,
  buildOnboardingState,
  buildSuitability,
  mockState,
} from './onboarding.mock';
import { SUITABILITY_QUESTIONS } from '../constants/onboarding.constants';
import type {
  Agreement,
  EligibilityResult,
  KycDraft,
  KycStatus,
  OnboardingState,
  SuitabilityAnswers,
  SuitabilityResult,
} from '../types/onboarding.types';

// ─── Feature flag: flip to false once real endpoints are ready ────────────────
const USE_MOCK =
  mockAllowed(process.env.EXPO_PUBLIC_ONBOARDING_USE_MOCK, true);

/** Simulated network latency so loading states render in mock mode. */
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;

/** Normalise a thrown axios error into an Error carrying the backend's message. */
function toOnboardingError(err: unknown): Error {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  const msg = e?.response?.data?.message ?? e?.message ?? 'Something went wrong. Please try again.';
  return new Error(msg);
}

// ─── Eligibility (GET /invest/eligibility) ────────────────────────────────────

export async function getEligibility(): Promise<EligibilityResult> {
  if (USE_MOCK) { await delay(180); return buildEligibility(); }
  try {
    return unwrap<EligibilityResult>(await api.get('/api/v1/invest/eligibility'));
  } catch (err) {
    throw toOnboardingError(err);
  }
}

// ─── Aggregate onboarding overview (GET /invest/profile) ──────────────────────

export async function getOnboardingState(): Promise<OnboardingState> {
  if (USE_MOCK) { await delay(200); return buildOnboardingState(); }
  try {
    return unwrap<OnboardingState>(await api.get('/api/v1/invest/profile'));
  } catch (err) {
    throw toOnboardingError(err);
  }
}

// ─── KYC (status + submit) ────────────────────────────────────────────────────

export async function getKycStatus(): Promise<KycStatus> {
  if (USE_MOCK) { await delay(200); return mockState.kycStatus; }
  try {
    const res = unwrap<{ status: KycStatus }>(await api.get('/api/v1/invest/profile'));
    return res.status;
  } catch (err) {
    throw toOnboardingError(err);
  }
}

export async function submitKyc(draft: KycDraft): Promise<{ status: KycStatus }> {
  if (USE_MOCK) {
    await delay(1100);
    // New submissions go to pending review (compliance gate).
    mockState.kycStatus = 'pending';
    return { status: 'pending' };
  }
  try {
    return unwrap<{ status: KycStatus }>(await api.post('/api/v1/invest/activate', draft));
  } catch (err) {
    throw toOnboardingError(err);
  }
}

// ─── Suitability (GET questions, POST submit, GET result) ─────────────────────

export async function getSuitabilityQuestions() {
  if (USE_MOCK) { await delay(160); return SUITABILITY_QUESTIONS; }
  try {
    return unwrap<typeof SUITABILITY_QUESTIONS>(await api.get('/api/v1/invest/suitability/questions'));
  } catch (err) {
    throw toOnboardingError(err);
  }
}

export async function getSuitability(): Promise<SuitabilityResult | null> {
  if (USE_MOCK) { await delay(200); return mockState.suitability; }
  try {
    return unwrap<SuitabilityResult | null>(await api.get('/api/v1/invest/suitability/result'));
  } catch (err) {
    throw toOnboardingError(err);
  }
}

export async function submitSuitability(answers: SuitabilityAnswers): Promise<SuitabilityResult> {
  if (USE_MOCK) {
    await delay(800);
    const result = buildSuitability(answers);
    mockState.suitability = result;
    return result;
  }
  try {
    return unwrap<SuitabilityResult>(await api.post('/api/v1/invest/suitability/submit', answers));
  } catch (err) {
    throw toOnboardingError(err);
  }
}

// ─── Agreements (GET list, POST accept) ───────────────────────────────────────

export async function getAgreements(): Promise<Agreement[]> {
  if (USE_MOCK) { await delay(220); return [...MOCK_AGREEMENTS]; }
  try {
    return unwrap<Agreement[]>(await api.get('/api/v1/invest/agreements'));
  } catch (err) {
    throw toOnboardingError(err);
  }
}

export async function acceptAgreements(ids: string[]): Promise<{ accepted: string[] }> {
  if (USE_MOCK) {
    await delay(600);
    mockState.acceptedAgreementIds = Array.from(new Set([...mockState.acceptedAgreementIds, ...ids]));
    return { accepted: mockState.acceptedAgreementIds };
  }
  try {
    return unwrap<{ accepted: string[] }>(await api.post('/api/v1/invest/agreements/accept', { ids }));
  } catch (err) {
    throw toOnboardingError(err);
  }
}
