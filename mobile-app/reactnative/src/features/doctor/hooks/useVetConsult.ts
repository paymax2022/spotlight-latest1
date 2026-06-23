// ── Doctor — Vet Consultation hooks (Batch 5, Section S) ─────────────────────
// Query keys under ['doctor', 'vet', …]. Mutations auto-generate the
// idempotencyKey. Vet chat/audio/video/SOAP REUSE the Batch 2 rich shapes;
// follow-up REUSES the Phase 2 FollowUpPlan via the existing follow-up hooks.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getVetAppointments,
  getPetOwnerRequests,
  getVetChatThread,
  getVetCallSession,
  getVetSoapNote,
  getPetEmergencyWarnings,
  getVetSpecialists,
  getVetReferrals,
  getVetConsultSummary,
  getVetConsultHistory,
  respondToPetRequest,
  saveVetSoapNote,
  createVetReferral,
  DEMO_VET_APPOINTMENTS,
  DEMO_PET_OWNER_REQUESTS,
  DEMO_VET_CHAT_THREAD,
  DEMO_VET_CALL_SESSION,
  DEMO_VET_CLINICAL_NOTE,
  DEMO_PET_EMERGENCY_WARNINGS,
  DEMO_VET_SPECIALISTS,
  DEMO_VET_REFERRALS,
  DEMO_VET_CONSULT_SUMMARY,
  DEMO_VET_CONSULT_HISTORY,
} from '@/api/doctor.batch5.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  RespondToPetRequestInput,
  SaveVetSoapNoteInput,
  CreateVetReferralInput,
} from '@/types/doctor.batch5';

// ─── Reads ────────────────────────────────────────────────────────────────────

export function useVetAppointments() {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'appointments'],
    queryFn:         getVetAppointments,
    placeholderData: DEMO_VET_APPOINTMENTS,
    staleTime:       30_000,
  });
}

export function usePetOwnerRequests() {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'owner-requests'],
    queryFn:         getPetOwnerRequests,
    placeholderData: DEMO_PET_OWNER_REQUESTS,
    staleTime:       30_000,
  });
}

export function useVetChatThread(petId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'chat', petId],
    queryFn:         () => getVetChatThread(petId),
    enabled:         !!petId,
    placeholderData: DEMO_VET_CHAT_THREAD,
    staleTime:       15_000,
  });
}

export function useVetCallSession(petId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'call', petId],
    queryFn:         () => getVetCallSession(petId),
    enabled:         !!petId,
    placeholderData: DEMO_VET_CALL_SESSION,
    staleTime:       15_000,
  });
}

export function useVetSoapNote(petId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'soap', petId],
    queryFn:         () => getVetSoapNote(petId),
    enabled:         !!petId,
    placeholderData: DEMO_VET_CLINICAL_NOTE,
    staleTime:       30_000,
  });
}

export function usePetEmergencyWarnings(petId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'emergency-warnings', petId],
    queryFn:         () => getPetEmergencyWarnings(petId),
    enabled:         !!petId,
    placeholderData: DEMO_PET_EMERGENCY_WARNINGS,
    staleTime:       30_000,
  });
}

export function useVetSpecialists() {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'specialists'],
    queryFn:         getVetSpecialists,
    placeholderData: DEMO_VET_SPECIALISTS,
    staleTime:       60_000,
  });
}

export function useVetReferrals(petId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'referrals', petId],
    queryFn:         () => getVetReferrals(petId),
    enabled:         !!petId,
    placeholderData: DEMO_VET_REFERRALS,
    staleTime:       30_000,
  });
}

export function useVetConsultSummary(consultId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'consult-summary', consultId],
    queryFn:         () => getVetConsultSummary(consultId),
    enabled:         !!consultId,
    placeholderData: DEMO_VET_CONSULT_SUMMARY,
    staleTime:       30_000,
  });
}

export function useVetConsultHistory() {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'consult-history'],
    queryFn:         getVetConsultHistory,
    placeholderData: DEMO_VET_CONSULT_HISTORY,
    staleTime:       30_000,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useRespondToPetRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RespondToPetRequestInput, 'idempotencyKey'>) =>
      respondToPetRequest({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet', 'owner-requests'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'vet', 'appointments'] });
    },
  });
}

export function useSaveVetSoapNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SaveVetSoapNoteInput, 'idempotencyKey'>) =>
      saveVetSoapNote({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet', 'soap', vars.petId] });
    },
  });
}

export function useCreateVetReferral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateVetReferralInput, 'idempotencyKey'>) =>
      createVetReferral({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet', 'referrals', vars.petId] });
    },
  });
}
