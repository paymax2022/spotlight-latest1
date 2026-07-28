import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';

export const adminKeys = {
  all: ['estateadmin'] as const,
  summary: () => [...adminKeys.all, 'summary'] as const,
  residents: (role?: string) => [...adminKeys.all, 'residents', role ?? 'all'] as const,
  audit: () => [...adminKeys.all, 'audit'] as const,
};

export function useAdminSummary() {
  return useQuery({ queryKey: adminKeys.summary(), queryFn: api.getAdminSummary });
}

export function useResidents(role?: string) {
  return useQuery({ queryKey: adminKeys.residents(role), queryFn: () => api.listResidents(role) });
}

export function useBanResident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason?: string }) => api.banResident(userId, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.all }),
  });
}

export function useRestoreResident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.restoreResident(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.all }),
  });
}

export function useRunMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.runMaintenance(),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.summary() }),
  });
}
