// ── Doctor — Batch 1 · Section C · vet profile & verification hooks ───────────
// Veterinary profile builder draft + verification lifecycle (vet equivalent of
// Section B). Reads use the DEMO_* exports as placeholderData; mutations
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
    placeholderData: DEMO_VET_PROFILE_DRAFT,
    staleTime:       30_000,
  });
}

export function useVetDocumentSlots() {
  return useQuery({
    queryKey:        ['doctor', 'vet-profile', 'document-slots'],
    queryFn:         getVetDocumentSlots,
    placeholderData: DEMO_VET_DOCUMENT_SLOTS,
    staleTime:       30_000,
  });
}

export function useVetVerification(submissionId?: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet-profile', 'verification', submissionId],
    queryFn:         () => getVetVerification(submissionId),
    placeholderData: DEMO_VET_VERIFICATION,
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
