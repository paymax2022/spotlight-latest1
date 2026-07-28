// ── Paymax Health — Veterinary React Query hooks (Phase 3) ───────────────────
// Declarative data hooks the vet screens use. React Query v5.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateIdempotencyKey } from '@/utils/idempotency';
import {
  getPets,
  getPet,
  createPet,
  updatePet,
  getPetRecords,
  getVaccinations,
  scheduleVaccination,
  getVets,
  getVet,
  getAvailability,
  getReviews,
  submitReview,
  getAppointments,
  getAppointment,
  createAppointment,
  rescheduleAppointment,
  cancelAppointment,
  getConsult,
  startConsult,
  sendConsultMessage,
  completeConsult,
  getConsultSummary,
  getPrescription,
  getPrescriptions,
  acknowledgeRecordConsent,
  sendRxToPharmacy,
  getMedications,
  requestRefill,
  getHomeVisitTracking,
  getEmergencyVets,
  getProviderProfile,
  submitProviderOnboarding,
  updateProviderProfile,
  getProviderAvailability,
  setProviderAvailability,
  getProviderAppointments,
  decideAppointment,
  getPetChart,
  saveSoapNote,
  issuePrescription,
  orderLabForPet,
  createReferral,
  getProviderEarnings,
  requestPayout,
  getProviderReviews,
  getProviderHomeNav,
  submitVcnVerification,
  getVcnStatus,
} from './api';
import type {
  PetInput,
  VetQuery,
  CreateAppointmentInput,
  RescheduleInput,
  SubmitReviewInput,
  SubmitOnboardingInput,
  UpdateProfileInput,
  ProviderAvailabilityBlock,
  DecisionInput,
  SaveSoapInput,
  IssueRxInput,
  OrderLabInput,
  ReferralInput,
  SubmitVcnInput,
} from './types';

const KEY = 'vet';

// ── Pets ────────────────────────────────────────────────────────────────────
export function usePets() {
  return useQuery({ queryKey: [KEY, 'pets'], queryFn: getPets, staleTime: 60_000 });
}

export function usePet(id?: string) {
  return useQuery({
    queryKey: [KEY, 'pet', id],
    queryFn: () => getPet(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

export function useCreatePet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PetInput) => createPet(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'pets'] }),
  });
}

export function useUpdatePet(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PetInput) => updatePet(id as string, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'pets'] });
      qc.invalidateQueries({ queryKey: [KEY, 'pet', id] });
    },
  });
}

export function usePetRecords(petId?: string) {
  return useQuery({
    queryKey: [KEY, 'pet-records', petId],
    queryFn: () => getPetRecords(petId as string),
    enabled: Boolean(petId),
    staleTime: 30_000,
  });
}

export function useVaccinations(petId?: string) {
  return useQuery({
    queryKey: [KEY, 'vaccinations', petId ?? 'all'],
    queryFn: () => getVaccinations(petId),
    staleTime: 30_000,
  });
}

export function useScheduleVaccination() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { vaccinationId: string; dueAt: string }) => scheduleVaccination(args.vaccinationId, args.dueAt),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'vaccinations'] }),
  });
}

// ── Vets ────────────────────────────────────────────────────────────────────
export function useVets(query?: VetQuery) {
  return useQuery({
    queryKey: [KEY, 'vets', query ?? {}],
    queryFn: () => getVets(query),
    staleTime: 60_000,
  });
}

export function useVet(id?: string) {
  return useQuery({
    queryKey: [KEY, 'vet', id],
    queryFn: () => getVet(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

export function useAvailability(vetId?: string) {
  return useQuery({
    queryKey: [KEY, 'availability', vetId],
    queryFn: () => getAvailability(vetId as string),
    enabled: Boolean(vetId),
    staleTime: 30_000,
  });
}

export function useReviews(vetId?: string) {
  return useQuery({
    queryKey: [KEY, 'reviews', vetId],
    queryFn: () => getReviews(vetId as string),
    enabled: Boolean(vetId),
  });
}

export function useSubmitReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitReviewInput) => submitReview(input),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: [KEY, 'reviews', v.vetId] }),
  });
}

// ── Appointments ──────────────────────────────────────────────────────────────
export function useAppointments() {
  return useQuery({ queryKey: [KEY, 'appointments'], queryFn: getAppointments, staleTime: 15_000 });
}

export function useAppointment(id?: string) {
  return useQuery({
    queryKey: [KEY, 'appointment', id],
    queryFn: () => getAppointment(id as string),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useCreateAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAppointmentInput) => createAppointment(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'appointments'] }),
  });
}

export function useRescheduleAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RescheduleInput) => rescheduleAppointment(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'appointments'] }),
  });
}

export function useCancelAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelAppointment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'appointments'] }),
  });
}

// ── Consult ─────────────────────────────────────────────────────────────────
export function useConsult(id?: string) {
  return useQuery({
    queryKey: [KEY, 'consult', id],
    queryFn: () => getConsult(id as string),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useStartConsult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => startConsult(id),
    onSuccess: (_d, id) => qc.invalidateQueries({ queryKey: [KEY, 'consult', id] }),
  });
}

export function useSendConsultMessage(consultId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => sendConsultMessage(consultId as string, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'consult', consultId] }),
  });
}

export function useCompleteConsult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => completeConsult(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: [KEY, 'consult', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'appointments'] });
    },
  });
}

export function useConsultSummary(id?: string) {
  return useQuery({
    queryKey: [KEY, 'summary', id],
    queryFn: () => getConsultSummary(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ── e-Prescription ────────────────────────────────────────────────────────────
export function usePrescription(id?: string) {
  return useQuery({
    queryKey: [KEY, 'prescription', id],
    queryFn: () => getPrescription(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function usePrescriptions(petId?: string) {
  return useQuery({
    queryKey: [KEY, 'prescriptions', petId ?? 'all'],
    queryFn: () => getPrescriptions(petId),
    staleTime: 30_000,
  });
}

export function useAcknowledgeRecordConsent() {
  return useMutation({ mutationFn: (recordId: string) => acknowledgeRecordConsent(recordId) });
}

export function useSendRxToPharmacy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prescriptionId: string) => sendRxToPharmacy(prescriptionId),
    onSuccess: (_d, id) => qc.invalidateQueries({ queryKey: [KEY, 'prescription', id] }),
  });
}

// ── Meds & refills ──────────────────────────────────────────────────────────
export function useMedications(petId?: string) {
  return useQuery({
    queryKey: [KEY, 'medications', petId ?? 'all'],
    queryFn: () => getMedications(petId),
    staleTime: 30_000,
  });
}

export function useRequestRefill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (medId: string) => requestRefill(medId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'medications'] }),
  });
}

// ── Home-visit tracking ─────────────────────────────────────────────────────
export function useHomeVisitTracking(appointmentId?: string) {
  return useQuery({
    queryKey: [KEY, 'tracking', appointmentId],
    queryFn: () => getHomeVisitTracking(appointmentId as string),
    enabled: Boolean(appointmentId),
    refetchInterval: 15_000,
  });
}

// ── Emergency ───────────────────────────────────────────────────────────────
export function useEmergencyVets() {
  return useQuery({ queryKey: [KEY, 'emergency'], queryFn: getEmergencyVets, staleTime: 60_000 });
}

// ── Provider ────────────────────────────────────────────────────────────────
export function useProviderProfile() {
  return useQuery({ queryKey: [KEY, 'provider', 'profile'], queryFn: getProviderProfile });
}

export function useSubmitProviderOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitOnboardingInput) => submitProviderOnboarding(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'provider', 'profile'] }),
  });
}

// ── Mode B (assisted) VCN verification ──────────────────────────────────────
export function useSubmitVcnVerification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitVcnInput) => submitVcnVerification(input),
    onSuccess: (data) =>
      qc.invalidateQueries({ queryKey: [KEY, 'vcn-status', data.applicationId] }),
  });
}

export function useVcnStatus(applicationId?: string) {
  return useQuery({
    queryKey: [KEY, 'vcn-status', applicationId],
    queryFn: () => getVcnStatus(applicationId as string),
    enabled: Boolean(applicationId),
    staleTime: 15_000,
  });
}

export function useUpdateProviderProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => updateProviderProfile(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'provider', 'profile'] }),
  });
}

export function useProviderAvailability() {
  return useQuery({ queryKey: [KEY, 'provider', 'availability'], queryFn: getProviderAvailability });
}

export function useSetProviderAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (blocks: ProviderAvailabilityBlock[]) => setProviderAvailability(blocks),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'provider', 'availability'] }),
  });
}

export function useProviderAppointments() {
  return useQuery({ queryKey: [KEY, 'provider', 'appointments'], queryFn: getProviderAppointments, staleTime: 10_000 });
}

export function useDecideAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DecisionInput) => decideAppointment(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'provider', 'appointments'] }),
  });
}

export function usePetChart(petId?: string) {
  return useQuery({
    queryKey: [KEY, 'provider', 'chart', petId],
    queryFn: () => getPetChart(petId as string),
    enabled: Boolean(petId),
    staleTime: 30_000,
  });
}

export function useSaveSoapNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveSoapInput) => saveSoapNote(input),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: [KEY, 'provider', 'chart', v.petId] }),
  });
}

export function useIssuePrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: IssueRxInput) => issuePrescription(input),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: [KEY, 'prescriptions', v.petId ?? 'all'] }),
  });
}

export function useOrderLabForPet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OrderLabInput) => orderLabForPet(input),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: [KEY, 'provider', 'chart', v.petId] }),
  });
}

export function useCreateReferral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReferralInput) => createReferral(input),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: [KEY, 'provider', 'chart', v.petId] }),
  });
}

export function useProviderEarnings() {
  return useQuery({ queryKey: [KEY, 'provider', 'earnings'], queryFn: getProviderEarnings });
}

export function useRequestPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountKobo: number) => requestPayout(amountKobo, generateIdempotencyKey()),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'provider', 'earnings'] }),
  });
}

export function useProviderReviews() {
  return useQuery({ queryKey: [KEY, 'provider', 'reviews'], queryFn: getProviderReviews });
}

export function useProviderHomeNav(appointmentId?: string) {
  return useQuery({
    queryKey: [KEY, 'provider', 'nav', appointmentId],
    queryFn: () => getProviderHomeNav(appointmentId as string),
    enabled: Boolean(appointmentId),
  });
}
