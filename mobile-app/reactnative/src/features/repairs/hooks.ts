import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateIdempotencyKey } from '@/utils/idempotency';
import * as api from './api';
import type { CreateRepairInput, AddRepairUpdateInput } from './api';

export const repairKeys = {
  all: ['repairs'] as const,
  list: () => [...repairKeys.all, 'list'] as const,
  detail: (id: string) => [...repairKeys.all, 'detail', id] as const,
};

export function useRepairs() { return useQuery({ queryKey: repairKeys.list(), queryFn: api.listRepairs }); }
export function useRepair(id: string) { return useQuery({ queryKey: repairKeys.detail(id), queryFn: () => api.getRepair(id), enabled: !!id }); }

export function useCreateRepair() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateRepairInput, 'idempotencyKey'>) => api.createRepair({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: repairKeys.list() }),
  });
}
export function useAddRepairUpdate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<AddRepairUpdateInput, 'idempotencyKey'>) => api.addRepairUpdate(id, { ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: repairKeys.detail(id) }); qc.invalidateQueries({ queryKey: repairKeys.list() }); },
  });
}
