// Veterinary profile builder draft + verification lifecycle (vet equivalent of
// auto-generate the Idempotency-Key.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getVetProfileDraft,
  getVetDocumentSlots,
  getVetVerification,
  saveVetProfileDraft,
  submitVetVerification,
  renewVetLicence,
  publishVetProfile,
  DEMO_VET_PROFILE_DRAFT,
  DEMO_VET_DOCUMENT_SLOTS,
  DEMO_VET_VERIFICATION,
} from '@/api/doctor.batch1.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
// DEMO_* placeholders only in mock mode: a live build must never render (or act on) invented rows.
import { DOCTOR_USE_MOCK } from '@/api/doctor.client';
import type {
  SaveVetProfileDraftInput,
  SubmitVetVerificationInput,
  RenewVetLicenceInput,
  PublishVetProfileInput,
} from '@/types/doctor.batch1';

export function useVetProfileDraft(draftId?: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet-profile', 'draft', draftId],
    queryFn:         () => getVetProfileDraft(draftId),
    placeholderData: DOCTOR_USE_MOCK ? DEMO_VET_PROFILE_DRAFT : undefined,
    staleTime:       30_000,
  });
}

export function useVetDocumentSlots() {
  return useQuery({
    queryKey:        ['doctor', 'vet-profile', 'document-slots'],
    queryFn:         getVetDocumentSlots,
    placeholderData: DOCTOR_USE_MOCK ? DEMO_VET_DOCUMENT_SLOTS : undefined,
    staleTime:       30_000,
  });
}

export function useVetVerification(submissionId?: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet-profile', 'verification', submissionId],
    queryFn:         () => getVetVerification(submissionId),
    placeholderData: DOCTOR_USE_MOCK ? DEMO_VET_VERIFICATION : undefined,
    staleTime:       30_000,
  });
}

export function useSaveVetProfileDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SaveVetProfileDraftInput, 'idempotencyKey'>) =>
      saveVetProfileDraft({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet-profile', 'draft'] });
    },
  });
}

export function useSubmitVetVerification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SubmitVetVerificationInput, 'idempotencyKey'>) =>
      submitVetVerification({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet-profile', 'verification'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'vet-profile', 'draft'] });
    },
  });
}

export function useRenewVetLicence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RenewVetLicenceInput, 'idempotencyKey'>) =>
      renewVetLicence({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet-profile', 'verification'] });
    },
  });
}

export function usePublishVetProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<PublishVetProfileInput, 'idempotencyKey'>) =>
      publishVetProfile({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet-profile', 'draft'] });
    },
  });
}
