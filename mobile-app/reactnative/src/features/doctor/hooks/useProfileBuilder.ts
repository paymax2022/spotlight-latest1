// Section B (31-screen Doctor Profile & Verification flow). Reads the draft,
// document slots, licence-expiry warning and verification decision; mutations
// auto-generate `idempotencyKey` and invalidate the relevant queries.
// Reuses (do NOT recreate): `useAvailability`/`useUpdateAvailability` and
// `useVerification` from `./useDoctorProfile` (screens 19, 25). This file is
// ADDITIVE to that hook module.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getProfileDraft,
  getDocumentSlots,
  getNigerianStates,
  getLgasByState,
  getLicenceExpiryWarning,
  getVerificationDecision,
  saveProfileDraft,
  uploadProfilePhoto,
  uploadDocument,
  saveBankAccount,
  verifyBankAccount,
  submitProfileVerification,
  renewLicence,
  publishProfile,
  DEMO_LICENCE_EXPIRY_WARNING,
  DEMO_VERIFICATION_DECISION,
} from '@/api/doctor.profile.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  SaveProfileDraftInput,
  UploadProfilePhotoInput,
  UploadDocumentInput,
  SaveBankAccountInput,
  VerifyBankAccountInput,
  SubmitProfileVerificationInput,
  RenewLicenceInput,
  PublishProfileInput,
} from '@/types/doctor.profile';

export function useProfileDraft(draftId?: string) {
  return useQuery({
    queryKey:        ['doctor', 'profile', 'draft', draftId],
    queryFn:         () => getProfileDraft(draftId),
    // No DEMO placeholder: every setup screen initializes its form with a
    // one-shot `if (draft && !form)` effect, so placeholder data would latch
    // the demo profile into a fresh user's form and get saved as real input.
    // Screens already render a loading StateView while !draft.
    staleTime:       30_000,
  });
}

export function useDocumentSlots() {
  return useQuery({
    queryKey:        ['doctor', 'profile', 'documents'],
    queryFn:         getDocumentSlots,
    // No DEMO placeholder: the licence screen seeds its upload state from the
    // slot's file on first render, so placeholder slots would latch the demo
    // "license.pdf" onto a real doctor's licence step and get saved to the draft.
    staleTime:       30_000,
  });
}

// Dojah-backed Nigerian geography for the affiliations address pickers. Cached
// hard (states/LGAs are static); the screen falls back to a static list / free
// text if these fail to load.
export function useNigerianStates() {
  return useQuery({
    queryKey:  ['doctor', 'geo', 'states'],
    queryFn:   getNigerianStates,
    staleTime: 1000 * 60 * 60 * 24,
  });
}

export function useLgasForState(state?: string) {
  return useQuery({
    queryKey:  ['doctor', 'geo', 'lgas', state ?? ''],
    queryFn:   () => getLgasByState(state as string),
    enabled:   !!state,
    staleTime: 1000 * 60 * 60 * 24,
  });
}

export function useLicenceExpiryWarning() {
  return useQuery({
    queryKey:        ['doctor', 'profile', 'licence-expiry'],
    queryFn:         getLicenceExpiryWarning,
    placeholderData: DEMO_LICENCE_EXPIRY_WARNING,
    staleTime:       30_000,
  });
}

export function useVerificationDecision(submissionId?: string) {
  return useQuery({
    queryKey:        ['doctor', 'profile', 'verification-decision', submissionId],
    queryFn:         () => getVerificationDecision(submissionId),
    placeholderData: DEMO_VERIFICATION_DECISION,
    staleTime:       30_000,
  });
}

export function useSaveProfileDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SaveProfileDraftInput, 'idempotencyKey'>) =>
      saveProfileDraft({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'profile', 'draft'] });
    },
  });
}

export function useUploadProfilePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<UploadProfilePhotoInput, 'idempotencyKey'>) =>
      uploadProfilePhoto({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'profile', 'draft'] });
    },
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<UploadDocumentInput, 'idempotencyKey'>) =>
      uploadDocument({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'profile', 'documents'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'profile', 'draft'] });
    },
  });
}

export function useSaveBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SaveBankAccountInput, 'idempotencyKey'>) =>
      saveBankAccount({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'profile', 'draft'] });
    },
  });
}

export function useVerifyBankAccount() {
  return useMutation({
    mutationFn: (input: VerifyBankAccountInput) => verifyBankAccount(input),
  });
}

export function useSubmitProfileVerification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SubmitProfileVerificationInput, 'idempotencyKey'>) =>
      submitProfileVerification({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'verification'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'profile', 'draft'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'profile', 'verification-decision'] });
    },
  });
}

export function useRenewLicence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RenewLicenceInput, 'idempotencyKey'>) =>
      renewLicence({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'profile', 'licence-expiry'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'verification'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'compliance'] });
    },
  });
}

export function usePublishProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<PublishProfileInput, 'idempotencyKey'>) =>
      publishProfile({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'profile'] });
    },
  });
}
