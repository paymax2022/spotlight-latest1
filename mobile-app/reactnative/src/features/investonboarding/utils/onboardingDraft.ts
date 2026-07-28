// ── Paymax Invest · Onboarding — Draft (in-flight onboarding state) ──────────
// A small module singleton the multi-step KYC + suitability flow reads/writes as
// the user progresses. Reset on entry (index). Kept out of React Query because
// it's transient client-only form state, not server data. Mirrors the fx
// kycDraft pattern (src/features/fx/utils/kycDraft.ts).

import type {
  AccountType,
  IdDocType,
  KycDraft,
  SuitabilityAnswers,
} from '../types/onboarding.types';

function emptyKycDraft(): KycDraft {
  return {
    accountType: 'individual',
    personal: { firstName: '', lastName: '', dob: '', bvn: '', nin: '' },
    idDocType: 'nin' as IdDocType,
    idFrontUploaded: false,
    idBackUploaded: false,
    selfieUploaded: false,
  };
}

export const kycDraft: { current: KycDraft } = { current: emptyKycDraft() };

export function resetKycDraft(accountType: AccountType = 'individual') {
  kycDraft.current = emptyKycDraft();
  kycDraft.current.accountType = accountType;
}

// ─── Suitability draft ────────────────────────────────────────────────────────

export const suitabilityDraft: { current: Partial<SuitabilityAnswers> } = { current: {} };

export function resetSuitabilityDraft() {
  suitabilityDraft.current = {};
}
