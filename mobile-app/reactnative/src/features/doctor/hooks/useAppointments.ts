// ── Doctor — appointments & patient profile hooks ────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAppointments,
  getAppointment,
  getPatientProfile,
  updateAppointmentStatus,
  DEMO_APPOINTMENTS,
} from '@/api/doctor.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  ConsultStatus,
  UpdateAppointmentStatusInput,
} from '@/types/doctor';

export function useAppointments(status?: ConsultStatus) {
  return useQuery({
    queryKey:        ['doctor', 'appointments', status],
    queryFn:         () => getAppointments(status),
    placeholderData: DEMO_APPOINTMENTS,
    staleTime:       30_000,
  });
}

export function useAppointment(id: string) {
  return useQuery({
    queryKey: ['doctor', 'appointment', id],
    queryFn:  () => getAppointment(id),
    enabled:  !!id,
    staleTime: 30_000,
  });
}

export function usePatientProfile(patientId: string) {
  return useQuery({
    queryKey: ['doctor', 'patient', patientId],
    queryFn:  () => getPatientProfile(patientId),
    enabled:  !!patientId,
    staleTime: 30_000,
  });
}

export function useUpdateAppointmentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<UpdateAppointmentStatusInput, 'idempotencyKey'>) =>
      updateAppointmentStatus({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'appointments'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'appointment', vars.appointmentId] });
    },
  });
}
