// ── Doctor — Section A (Onboarding) hooks ────────────────────────────────────
// Query keys under ['doctor', 'onboarding', …]. Reads use the DEMO_* exports as
// placeholderData. Mutations auto-generate the idempotencyKey and accept
// `Omit<Input, 'idempotencyKey'>`. ADDITIVE; exported from hooks/index.ts via a
// single new line.
//
// REUSE notes:
//   - Entries 5/6 (doctor / specialist profile update) → use the existing
//     Section B hooks in useProfileBuilder.ts (e.g. useProfileDraft,
//     useSaveProfileDraft, useSubmitProfileVerification).
//   - Entry 7 (veterinary profile update) → use the existing Section C / Batch 1
//     hooks in useVetProfile.ts (e.g. useVetProfileDraft, useSubmitVetVerification).
//   - Entries 17–20 (account pending / rejected / suspended / under review) →
//     REUSE useAccountStatus from useAppStatus.ts. `useOnboardingAccountStatus`
//     below is a thin alias re-export so a Section A screen can import it from a
//     single Section A import site without re-declaring the query.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getOnboardingSlides,
  getMerchantUpgradeStatus,
  getLegalDocument,
  getConsentStatus,
  getPermissionStates,
  requestMerchantUpgrade,
  selectProviderType,
  acceptConsent,
  recordPermissionDecision,
  DEMO_ONBOARDING_SLIDES,
  DEMO_MERCHANT_UPGRADE_STATUS,
  DEMO_LEGAL_DOCUMENTS,
  DEMO_CONSENT_STATUS,
  DEMO_PERMISSION_STATES,
} from '@/api/doctor.onboarding.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
// REUSE: entries 17–20 lean on the Batch 7 account-status hook.
import { useAccountStatus } from '@/features/doctor/hooks/useAppStatus';
import type {
  LegalDocKind,
  RequestMerchantUpgradeInput,
  SelectProviderTypeInput,
  AcceptConsentInput,
  RecordPermissionDecisionInput,
} from '@/types/doctor.onboarding';

// ─── Reads ────────────────────────────────────────────────────────────────────

// Entry 2 — intro carousel
export function useOnboardingSlides() {
  return useQuery({
    queryKey:        ['doctor', 'onboarding', 'slides'],
    queryFn:         getOnboardingSlides,
    placeholderData: DEMO_ONBOARDING_SLIDES,
    staleTime:       300_000,
  });
}

// Entries 3 & 4 — merchant (provider) upgrade lifecycle
export function useMerchantUpgradeStatus() {
  return useQuery({
    queryKey:        ['doctor', 'onboarding', 'merchant-upgrade'],
    queryFn:         getMerchantUpgradeStatus,
    placeholderData: DEMO_MERCHANT_UPGRADE_STATUS,
    staleTime:       30_000,
  });
}

// Entries 8–12 — a single legal document
export function useLegalDocument(kind: LegalDocKind) {
  return useQuery({
    queryKey:        ['doctor', 'onboarding', 'legal', kind],
    queryFn:         () => getLegalDocument(kind),
    placeholderData: DEMO_LEGAL_DOCUMENTS[kind],
    staleTime:       300_000,
  });
}

// Entries 8–12 — aggregate consent status
export function useConsentStatus() {
  return useQuery({
    queryKey:        ['doctor', 'onboarding', 'consents'],
    queryFn:         getConsentStatus,
    placeholderData: DEMO_CONSENT_STATUS,
    staleTime:       30_000,
  });
}

// Entries 13–16 — recorded OS permission states
export function usePermissionStates() {
  return useQuery({
    queryKey:        ['doctor', 'onboarding', 'permissions'],
    queryFn:         getPermissionStates,
    placeholderData: DEMO_PERMISSION_STATES,
    staleTime:       30_000,
  });
}

// Entries 17–20 — REUSE the Batch 7 account-status query under a Section A name.
export function useOnboardingAccountStatus() {
  return useAccountStatus();
}

// ─── Mutations ──────────────────────────────────────────────────────────────

// Entry 3 — request user→merchant (provider) upgrade
export function useRequestMerchantUpgrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input?: Omit<RequestMerchantUpgradeInput, 'idempotencyKey'>) =>
      requestMerchantUpgrade({ ...(input ?? {}), idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'onboarding', 'merchant-upgrade'] });
    },
  });
}

// Entry 4 — choose provider type
export function useSelectProviderType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SelectProviderTypeInput, 'idempotencyKey'>) =>
      selectProviderType({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'onboarding', 'merchant-upgrade'] });
    },
  });
}

// Entries 8–12 — accept a legal document (versioned)
export function useAcceptConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<AcceptConsentInput, 'idempotencyKey'>) =>
      acceptConsent({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'onboarding', 'consents'] });
    },
  });
}

// Entries 13–16 — record an OS permission decision
export function useRecordPermissionDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RecordPermissionDecisionInput, 'idempotencyKey'>) =>
      recordPermissionDecision({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'onboarding', 'permissions'] });
    },
  });
}
