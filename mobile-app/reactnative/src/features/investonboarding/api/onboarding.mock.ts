// ── Paymax Invest · Onboarding — Mock fixtures + in-memory state ─────────────
// Deterministic seed data + a tiny in-memory state machine so every onboarding
// UI state renders in mock mode. Flip EXPO_PUBLIC_ONBOARDING_USE_MOCK=false to
// hit the real Paymax endpoints (onboarding.api.ts).

import { AGREEMENTS } from '../constants/onboarding.constants';
import { scoreSuitability } from '../utils/onboarding.utils';
import type {
  Agreement,
  EligibilityResult,
  KycStatus,
  OnboardingState,
  SuitabilityAnswers,
  SuitabilityResult,
} from '../types/onboarding.types';

/**
 * Mutable in-memory state the mock API reads/writes, so submitting KYC /
 * suitability / agreements moves the user through the gate within a session.
 * Starts as a brand-new user (nothing done yet).
 */
export const mockState: {
  kycStatus: KycStatus;
  suitability: SuitabilityResult | null;
  acceptedAgreementIds: string[];
} = {
  kycStatus: 'unstarted',
  suitability: null,
  acceptedAgreementIds: [],
};

export function resetMockState() {
  mockState.kycStatus = 'unstarted';
  mockState.suitability = null;
  mockState.acceptedAgreementIds = [];
}

// ─── Eligibility ──────────────────────────────────────────────────────────────

export function buildEligibility(): EligibilityResult {
  // Mock: a Nigerian resident in a supported region. Flip `investEnabled` to
  // false (or change `state`) to exercise the product-unavailable path.
  return {
    state: 'eligible',
    region: 'Nigeria',
    residency: 'Nigeria',
    investEnabled: true,
    message: 'Paymax Invest is available in your region.',
  };
}

// ─── Agreements ───────────────────────────────────────────────────────────────

export const MOCK_AGREEMENTS: Agreement[] = AGREEMENTS;

// ─── Suitability ──────────────────────────────────────────────────────────────

export function buildSuitability(answers: SuitabilityAnswers): SuitabilityResult {
  return scoreSuitability(answers);
}

// ─── Aggregate onboarding state ───────────────────────────────────────────────

export function buildOnboardingState(): OnboardingState {
  const requiredIds = MOCK_AGREEMENTS.filter((a) => a.required).map((a) => a.id);
  const agreementsComplete = requiredIds.every((id) => mockState.acceptedAgreementIds.includes(id));
  return {
    kycStatus: mockState.kycStatus,
    suitabilityComplete: Boolean(mockState.suitability),
    agreementsComplete,
    riskCategory: mockState.suitability?.riskCategory,
  };
}
