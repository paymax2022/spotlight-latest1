// Query keys under ['doctor', 'vet', …]. Mutations auto-generate the
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
// DEMO_* placeholders only in mock mode: a live build must never render (or act on) invented rows.
import { DOCTOR_USE_MOCK } from '@/api/doctor.client';
import type {
  RespondToPetRequestInput,
  SaveVetSoapNoteInput,
  CreateVetReferralInput,
} from '@/types/doctor.batch5';

export function useVetAppointments() {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'appointments'],
    queryFn:         getVetAppointments,
    placeholderData: DOCTOR_USE_MOCK ? DEMO_VET_APPOINTMENTS : undefined,
    staleTime:       30_000,
  });
}

export function usePetOwnerRequests() {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'owner-requests'],
    queryFn:         getPetOwnerRequests,
    placeholderData: DOCTOR_USE_MOCK ? DEMO_PET_OWNER_REQUESTS : undefined,
    staleTime:       30_000,
  });
}

export function useVetChatThread(petId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'chat', petId],
    queryFn:         () => getVetChatThread(petId),
    enabled:         !!petId,
    placeholderData: DOCTOR_USE_MOCK ? DEMO_VET_CHAT_THREAD : undefined,
    staleTime:       15_000,
  });
}

export function useVetCallSession(petId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'call', petId],
    queryFn:         () => getVetCallSession(petId),
    enabled:         !!petId,
    placeholderData: DOCTOR_USE_MOCK ? DEMO_VET_CALL_SESSION : undefined,
    staleTime:       15_000,
  });
}

export function useVetSoapNote(petId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'soap', petId],
    queryFn:         () => getVetSoapNote(petId),
    enabled:         !!petId,
    placeholderData: DOCTOR_USE_MOCK ? DEMO_VET_CLINICAL_NOTE : undefined,
    staleTime:       30_000,
  });
}

export function usePetEmergencyWarnings(petId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'emergency-warnings', petId],
    queryFn:         () => getPetEmergencyWarnings(petId),
    enabled:         !!petId,
    placeholderData: DOCTOR_USE_MOCK ? DEMO_PET_EMERGENCY_WARNINGS : undefined,
    staleTime:       30_000,
  });
}

export function useVetSpecialists() {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'specialists'],
    queryFn:         getVetSpecialists,
    placeholderData: DOCTOR_USE_MOCK ? DEMO_VET_SPECIALISTS : undefined,
    staleTime:       60_000,
  });
}

export function useVetReferrals(petId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'referrals', petId],
    queryFn:         () => getVetReferrals(petId),
    enabled:         !!petId,
    placeholderData: DOCTOR_USE_MOCK ? DEMO_VET_REFERRALS : undefined,
    staleTime:       30_000,
  });
}

export function useVetConsultSummary(consultId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'consult-summary', consultId],
    queryFn:         () => getVetConsultSummary(consultId),
    enabled:         !!consultId,
    placeholderData: DOCTOR_USE_MOCK ? DEMO_VET_CONSULT_SUMMARY : undefined,
    staleTime:       30_000,
  });
}

export function useVetConsultHistory() {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'consult-history'],
    queryFn:         getVetConsultHistory,
    placeholderData: DOCTOR_USE_MOCK ? DEMO_VET_CONSULT_HISTORY : undefined,
    staleTime:       30_000,
  });
}

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
