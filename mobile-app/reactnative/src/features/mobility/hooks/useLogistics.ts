// ── Business Logistics — data hooks ──────────────────────────────────────────
// React Query hooks for the business-logistics mode, mirroring useModes.ts so
// screens stay declarative and share caching / loading / error contracts. Money
// mutations attach Idempotency-Keys via newIdempotencyKey.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as logistics from '../api/logistics.api';
import { LOGISTICS_KEY } from '../constants/modes.constants';
import { newIdempotencyKey, toMobilityError } from '../utils/mobilityFormatters';
import type {
  AccountCreateRequest,
  DeliveryCreateRequest,
  DeliveryStatus,
  BatchCreateRequest,
} from '../types/logistics.types';

// ─── Account ────────────────────────────────────────────────────────────────
export function useBusinessAccount() {
  return useQuery({
    queryKey: [LOGISTICS_KEY, 'account'],
    queryFn: logistics.getMyBusinessAccount,
    staleTime: 30_000,
  });
}

export function useCreateBusinessAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: AccountCreateRequest) => logistics.createBusinessAccount(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: [LOGISTICS_KEY, 'account'] }),
    onError: (e) => { throw toMobilityError(e); },
  });
}

// ─── Deliveries ─────────────────────────────────────────────────────────────
export function useCreateDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: Omit<DeliveryCreateRequest, 'idempotencyKey'>) =>
      logistics.createDelivery({ ...req, idempotencyKey: newIdempotencyKey('logistics-dlv') }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [LOGISTICS_KEY, 'deliveries'] }),
  });
}

export function useDeliveries(status?: DeliveryStatus) {
  return useQuery({
    queryKey: [LOGISTICS_KEY, 'deliveries', status ?? 'all'],
    queryFn: () => logistics.getDeliveries(status),
    staleTime: 15_000,
  });
}

export function useDelivery(id?: string, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: [LOGISTICS_KEY, 'delivery', id],
    queryFn: () => logistics.getDelivery(id as string),
    enabled: Boolean(id),
    refetchInterval: options?.poll ? 4_000 : false,
    staleTime: 2_000,
  });
}

export function useCancelDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => logistics.cancelDelivery(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [LOGISTICS_KEY] }),
  });
}

// ─── Batches ──────────────────────────────────────────────────────────────────
export function useCreateBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: Omit<BatchCreateRequest, 'idempotencyKey'>) =>
      logistics.createBatch({ ...req, idempotencyKey: newIdempotencyKey('logistics-bch') }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [LOGISTICS_KEY, 'batches'] });
      qc.invalidateQueries({ queryKey: [LOGISTICS_KEY, 'deliveries'] });
    },
  });
}

export function useBatches() {
  return useQuery({ queryKey: [LOGISTICS_KEY, 'batches'], queryFn: logistics.getBatches, staleTime: 20_000 });
}

export function useBatch(id?: string) {
  return useQuery({
    queryKey: [LOGISTICS_KEY, 'batch', id],
    queryFn: () => logistics.getBatch(id as string),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

// ─── Invoices + analytics ──────────────────────────────────────────────────────
export function useInvoices() {
  return useQuery({ queryKey: [LOGISTICS_KEY, 'invoices'], queryFn: logistics.getInvoices, staleTime: 60_000 });
}

export function useAnalytics() {
  return useQuery({ queryKey: [LOGISTICS_KEY, 'analytics'], queryFn: logistics.getAnalytics, staleTime: 30_000 });
}
