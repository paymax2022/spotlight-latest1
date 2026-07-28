// ── Doctor — profile, verification & availability hooks ──────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getDoctorProfile,
  getVerification,
  getAvailability,
  submitVerification,
  updateAvailability,
  DEMO_DOCTOR_PROFILE,
  DEMO_VERIFICATION,
  DEMO_AVAILABILITY,
} from '@/api/doctor.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  SubmitVerificationInput,
  UpdateAvailabilityInput,
} from '@/types/doctor';

export function useDoctorProfile() {
  return useQuery({
    queryKey:        ['doctor', 'profile'],
    queryFn:         getDoctorProfile,
    placeholderData: DEMO_DOCTOR_PROFILE,
    staleTime:       30_000,
  });
}

export function useVerification() {
  return useQuery({
    queryKey:        ['doctor', 'verification'],
    queryFn:         getVerification,
    placeholderData: DEMO_VERIFICATION,
    staleTime:       30_000,
  });
}

export function useAvailability(doctorId?: string) {
  return useQuery({
    queryKey:        ['doctor', 'availability', doctorId],
    queryFn:         () => getAvailability(doctorId),
    placeholderData: DEMO_AVAILABILITY,
    staleTime:       30_000,
  });
}

export function useSubmitVerification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SubmitVerificationInput, 'idempotencyKey'>) =>
      submitVerification({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'verification'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'profile'] });
    },
  });
}

export function useUpdateAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<UpdateAvailabilityInput, 'idempotencyKey'>) =>
      updateAvailability({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'availability'] });
    },
  });
}
