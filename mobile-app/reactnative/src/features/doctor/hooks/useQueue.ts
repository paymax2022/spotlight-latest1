// ── Doctor — Batch 1 · Section F · appointment & consultation queue hooks ──────
// Consultation queue / priority queue, pending appointment requests (accept /
// reject / reschedule-request), and the consult lifecycle (start / end /
// no-show). Reuses the Phase 1 DoctorAppointment + useUpdateAppointmentStatus
// (re-exported here for convenience). Reads use the DEMO_* exports as
// placeholderData; mutations auto-generate the Idempotency-Key.
// `computeConsultCountdown` is a pure helper (re-exported for the UI).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getConsultationQueue,
  getAppointmentRequests,
  getAppointmentRequest,
  acceptAppointment,
  rejectAppointment,
  requestReschedule,
  startConsultation,
  endConsultation,
  markNoShow,
  DEMO_QUEUE,
  DEMO_APPOINTMENT_REQUESTS,
} from '@/api/doctor.batch1.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  AcceptAppointmentInput,
  RejectAppointmentInput,
  RequestRescheduleInput,
  StartConsultationInput,
  EndConsultationInput,
  MarkNoShowInput,
} from '@/types/doctor.batch1';

// Re-export the pure countdown helper so screens can import it from the hooks
// barrel alongside the queue hooks.
export { computeConsultCountdown } from '@/api/doctor.batch1.api';

// NOTE: the Phase 1 `useUpdateAppointmentStatus` (from `./useAppointments`,
// already exported via the hooks barrel) is REUSED for generic status
// transitions the named mutations below don't cover. It is intentionally NOT
// re-exported here to avoid a duplicate barrel export.

export function useConsultationQueue() {
  return useQuery({
    queryKey:        ['doctor', 'queue'],
    queryFn:         getConsultationQueue,
    placeholderData: DEMO_QUEUE,
    staleTime:       15_000,
  });
}

export function useAppointmentRequests() {
  return useQuery({
    queryKey:        ['doctor', 'appointment-requests'],
    queryFn:         getAppointmentRequests,
    placeholderData: DEMO_APPOINTMENT_REQUESTS,
    staleTime:       15_000,
  });
}

export function useAppointmentRequest(id: string) {
  return useQuery({
    queryKey:  ['doctor', 'appointment-request', id],
    queryFn:   () => getAppointmentRequest(id),
    enabled:   !!id,
    staleTime: 15_000,
  });
}

export function useAcceptAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<AcceptAppointmentInput, 'idempotencyKey'>) =>
      acceptAppointment({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'appointment-requests'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'appointment-request', vars.appointmentId] });
      qc.invalidateQueries({ queryKey: ['doctor', 'queue'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'appointments'] });
    },
  });
}

export function useRejectAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RejectAppointmentInput, 'idempotencyKey'>) =>
      rejectAppointment({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'appointment-requests'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'queue'] });
    },
  });
}

export function useRequestReschedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RequestRescheduleInput, 'idempotencyKey'>) =>
      requestReschedule({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'appointment-requests'] });
    },
  });
}

export function useStartConsultation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<StartConsultationInput, 'idempotencyKey'>) =>
      startConsultation({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'queue'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'appointment', vars.appointmentId] });
      qc.invalidateQueries({ queryKey: ['doctor', 'dashboard'] });
    },
  });
}

export function useEndConsultation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<EndConsultationInput, 'idempotencyKey'>) =>
      endConsultation({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'queue'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'appointment', vars.appointmentId] });
      qc.invalidateQueries({ queryKey: ['doctor', 'dashboard'] });
    },
  });
}

export function useMarkNoShow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<MarkNoShowInput, 'idempotencyKey'>) =>
      markNoShow({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'queue'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'appointment', vars.appointmentId] });
    },
  });
}
