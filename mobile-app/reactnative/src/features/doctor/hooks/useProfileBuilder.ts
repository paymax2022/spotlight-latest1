// ── Doctor — Section B profile builder & verification lifecycle hooks ─────────
// Section B (31-screen Doctor Profile & Verification flow). Reads the draft,
// document slots, licence-expiry warning and verification decision; mutations
// auto-generate `idempotencyKey` and invalidate the relevant queries.
//
// Reuses (do NOT recreate): `useAvailability`/`useUpdateAvailability` and
// `useVerification` from `./useDoctorProfile` (screens 19, 25). This file is
// ADDITIVE to that hook module.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getProfileDraft,
  getDocumentSlots,
  getLicenceExpiryWarning,
  getVerificationDecision,
  saveProfileDraft,
  uploadProfilePhoto,
  uploadDocument,
  saveBankAccount,
  saveTaxInfo,
  submitProfileVerification,
  renewLicence,
  publishProfile,
  DEMO_PROFILE_DRAFT,
  DEMO_DOCUMENT_SLOTS,
  DEMO_LICENCE_EXPIRY_WARNING,
  DEMO_VERIFICATION_DECISION,
} from '@/api/doctor.profile.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  SaveProfileDraftInput,
  UploadProfilePhotoInput,
  UploadDocumentInput,
  SaveBankAccountInput,
  SaveTaxInfoInput,
  SubmitProfileVerificationInput,
  RenewLicenceInput,
  PublishProfileInput,
} from '@/types/doctor.profile';

// ─── Reads ───────────────────────────────────────────────────────────────────

export function useProfileDraft(draftId?: string) {
  return useQuery({
    queryKey:        ['doctor', 'profile', 'draft', draftId],
    queryFn:         () => getProfileDraft(draftId),
    placeholderData: DEMO_PROFILE_DRAFT,
    staleTime:       30_000,
  });
}

export function useDocumentSlots() {
  return useQuery({
    queryKey:        ['doctor', 'profile', 'documents'],
    queryFn:         getDocumentSlots,
    placeholderData: DEMO_DOCUMENT_SLOTS,
    staleTime:       30_000,
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

// ─── Mutations ───────────────────────────────────────────────────────────────

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

export function useSaveTaxInfo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SaveTaxInfoInput, 'idempotencyKey'>) =>
      saveTaxInfo({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'profile', 'draft'] });
    },
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
