// ── Doctor — notifications, support & settings hooks ──────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getNotifications,
  getSupportTickets,
  getSettings,
  createSupportTicket,
  updateSettings,
  DEMO_NOTIFICATIONS,
  DEMO_SUPPORT_TICKETS,
  DEMO_SETTINGS,
} from '@/api/doctor.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  CreateSupportTicketInput,
  UpdateDoctorSettingsInput,
} from '@/types/doctor';

export function useNotifications() {
  return useQuery({
    queryKey:        ['doctor', 'notifications'],
    queryFn:         getNotifications,
    placeholderData: DEMO_NOTIFICATIONS,
    staleTime:       15_000,
  });
}

export function useSupportTickets() {
  return useQuery({
    queryKey:        ['doctor', 'support-tickets'],
    queryFn:         getSupportTickets,
    placeholderData: DEMO_SUPPORT_TICKETS,
    staleTime:       30_000,
  });
}

export function useSettings() {
  return useQuery({
    queryKey:        ['doctor', 'settings'],
    queryFn:         getSettings,
    placeholderData: DEMO_SETTINGS,
    staleTime:       30_000,
  });
}

export function useCreateSupportTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateSupportTicketInput, 'idempotencyKey'>) =>
      createSupportTicket({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'support-tickets'] });
    },
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<UpdateDoctorSettingsInput, 'idempotencyKey'>) =>
      updateSettings({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'settings'] });
    },
  });
}
