import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateIdempotencyKey } from '@/utils/idempotency';
import * as api from './api';

export const duesKeys = { all: ['dues'] as const, list: () => [...duesKeys.all, 'list'] as const };

export function useInvoices() { return useQuery({ queryKey: duesKeys.list(), queryFn: api.listInvoices }); }

export function usePayInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.payInvoice(id, generateIdempotencyKey()),
    onSuccess: () => qc.invalidateQueries({ queryKey: duesKeys.list() }),
  });
}
