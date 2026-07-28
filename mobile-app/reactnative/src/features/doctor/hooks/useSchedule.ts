// ── Doctor — Batch 1 · Section E · availability & schedule hooks ───────────────
// Extended schedule settings (blocked dates, vacation, reminders, recurring
// rules, timezone, emergency toggle) on top of the Phase 1 AvailabilitySchedule.
// Reads use the DEMO_* exports as placeholderData; mutations auto-generate the
// Idempotency-Key. `checkOverbooking` is a pure helper (re-exported for the UI).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getScheduleSettings,
  getBlockedDates,
  blockDate,
  setVacation,
  toggleEmergency,
  saveReminderSettings,
  saveRecurringRule,
  setTimezone,
  rescheduleAppointment,
  cancelAppointment,
  DEMO_SCHEDULE_SETTINGS,
  DEMO_BLOCKED_DATES,
} from '@/api/doctor.batch1.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  BlockDateInput,
  SetVacationInput,
  ToggleEmergencyInput,
  SaveReminderSettingsInput,
  SaveRecurringRuleInput,
  SetTimezoneInput,
  RescheduleAppointmentInput,
  CancelAppointmentInput,
} from '@/types/doctor.batch1';

// Re-export the pure overbooking helper so screens can import it from the hooks
// barrel alongside the schedule hooks.
export { checkOverbooking } from '@/api/doctor.batch1.api';

export function useScheduleSettings() {
  return useQuery({
    queryKey:        ['doctor', 'schedule', 'settings'],
    queryFn:         getScheduleSettings,
    placeholderData: DEMO_SCHEDULE_SETTINGS,
    staleTime:       30_000,
  });
}

export function useBlockedDates() {
  return useQuery({
    queryKey:        ['doctor', 'schedule', 'blocked-dates'],
    queryFn:         getBlockedDates,
    placeholderData: DEMO_BLOCKED_DATES,
    staleTime:       30_000,
  });
}

export function useBlockDate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<BlockDateInput, 'idempotencyKey'>) =>
      blockDate({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'schedule', 'blocked-dates'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'schedule', 'settings'] });
    },
  });
}

export function useSetVacation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SetVacationInput, 'idempotencyKey'>) =>
      setVacation({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'schedule', 'settings'] });
    },
  });
}

export function useToggleEmergency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ToggleEmergencyInput, 'idempotencyKey'>) =>
      toggleEmergency({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'schedule', 'settings'] });
    },
  });
}

export function useSaveReminderSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SaveReminderSettingsInput, 'idempotencyKey'>) =>
      saveReminderSettings({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'schedule', 'settings'] });
    },
  });
}

export function useSaveRecurringRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SaveRecurringRuleInput, 'idempotencyKey'>) =>
      saveRecurringRule({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'schedule', 'settings'] });
    },
  });
}

export function useSetTimezone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SetTimezoneInput, 'idempotencyKey'>) =>
      setTimezone({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'schedule', 'settings'] });
    },
  });
}

// Reschedule / cancel a confirmed appointment from the schedule manager. These
// also invalidate the Phase 1 appointment caches.
export function useRescheduleAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RescheduleAppointmentInput, 'idempotencyKey'>) =>
      rescheduleAppointment({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'appointments'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'appointment', vars.appointmentId] });
    },
  });
}

export function useCancelAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CancelAppointmentInput, 'idempotencyKey'>) =>
      cancelAppointment({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'appointments'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'appointment', vars.appointmentId] });
    },
  });
}
