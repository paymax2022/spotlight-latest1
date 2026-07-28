// ── Doctor — Vet Lab & Pet Health hooks (Batch 5, Section U) ─────────────────
// Query keys under ['doctor', 'vet', …]. Mutations auto-generate the
// idempotencyKey. REUSES the Phase 3 pet lab order / result hooks (useVet.ts)
// for the create-order + mark-reviewed flows; this file adds the catalogue,
// inbox/interpretation, vaccination recs/reminders, health record, growth
// timeseries and chronic monitoring.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPetLabCatalogue,
  getPetLabInbox,
  getPetVaccinationRecommendations,
  getPetVaccinationReminders,
  getPetHealthRecord,
  getPetGrowthHistory,
  getPetChronicMonitoring,
  addPetLabInterpretation,
  setPetVaccinationReminder,
  recordPetGrowth,
  savePetChronicMonitoring,
  DEMO_PET_LAB_CATALOGUE,
  DEMO_PET_LAB_INBOX,
  DEMO_PET_VACCINATION_RECOMMENDATIONS,
  DEMO_PET_VACCINATION_REMINDERS,
  DEMO_PET_HEALTH_RECORD,
  DEMO_PET_GROWTH_HISTORY,
  DEMO_PET_CHRONIC_MONITORING,
} from '@/api/doctor.batch5.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  PetSpecies,
  AddPetLabInterpretationInput,
  SetPetVaccinationReminderInput,
  RecordPetGrowthInput,
  SavePetChronicMonitoringInput,
} from '@/types/doctor.batch5';

// ─── Reads ────────────────────────────────────────────────────────────────────

export function usePetLabCatalogue(species?: PetSpecies) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'lab-catalogue', species],
    queryFn:         () => getPetLabCatalogue(species),
    placeholderData: DEMO_PET_LAB_CATALOGUE,
    staleTime:       60_000,
  });
}

export function usePetLabInbox() {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'lab-inbox'],
    queryFn:         getPetLabInbox,
    placeholderData: DEMO_PET_LAB_INBOX,
    staleTime:       30_000,
  });
}

export function usePetVaccinationRecommendations(petId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'vaccination-recs', petId],
    queryFn:         () => getPetVaccinationRecommendations(petId),
    enabled:         !!petId,
    placeholderData: DEMO_PET_VACCINATION_RECOMMENDATIONS,
    staleTime:       30_000,
  });
}

export function usePetVaccinationReminders(petId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'vaccination-reminders', petId],
    queryFn:         () => getPetVaccinationReminders(petId),
    enabled:         !!petId,
    placeholderData: DEMO_PET_VACCINATION_REMINDERS,
    staleTime:       30_000,
  });
}

export function usePetHealthRecord(petId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'health-record', petId],
    queryFn:         () => getPetHealthRecord(petId),
    enabled:         !!petId,
    placeholderData: DEMO_PET_HEALTH_RECORD,
    staleTime:       30_000,
  });
}

export function usePetGrowthHistory(petId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'growth', petId],
    queryFn:         () => getPetGrowthHistory(petId),
    enabled:         !!petId,
    placeholderData: DEMO_PET_GROWTH_HISTORY,
    staleTime:       30_000,
  });
}

export function usePetChronicMonitoring(petId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'chronic-monitoring', petId],
    queryFn:         () => getPetChronicMonitoring(petId),
    enabled:         !!petId,
    placeholderData: DEMO_PET_CHRONIC_MONITORING,
    staleTime:       30_000,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useAddPetLabInterpretation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<AddPetLabInterpretationInput, 'idempotencyKey'>) =>
      addPetLabInterpretation({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet', 'lab-inbox'] });
    },
  });
}

export function useSetPetVaccinationReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SetPetVaccinationReminderInput, 'idempotencyKey'>) =>
      setPetVaccinationReminder({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet', 'vaccination-reminders', vars.petId] });
    },
  });
}

export function useRecordPetGrowth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RecordPetGrowthInput, 'idempotencyKey'>) =>
      recordPetGrowth({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet', 'growth', vars.petId] });
    },
  });
}

export function useSavePetChronicMonitoring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SavePetChronicMonitoringInput, 'idempotencyKey'>) =>
      savePetChronicMonitoring({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet', 'chronic-monitoring', vars.petId] });
    },
  });
}
