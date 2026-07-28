import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateIdempotencyKey } from '@/utils/idempotency';
import * as api from './api';
import type { CreateEmergencyInput } from './api';

export const emergencyKeys = { all: ['emergencies'] as const, list: () => [...emergencyKeys.all, 'list'] as const };

export function useEmergencies() { return useQuery({ queryKey: emergencyKeys.list(), queryFn: api.listEmergencies }); }

export function useCreateEmergency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateEmergencyInput, 'idempotencyKey'>) => api.createEmergency({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: emergencyKeys.list() }),
  });
}
export function useResolveEmergency() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.resolveEmergency(id), onSuccess: () => qc.invalidateQueries({ queryKey: emergencyKeys.list() }) });
}
