import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import type { SendInput, RequestInput, CreateSplitInput, CreatePoolInput } from './types';

const KEYS = {
  me:       ['social', 'me'] as const,
  activity: ['social', 'activity'] as const,
  contacts: ['social', 'contacts'] as const,
  search:   (q: string) => ['social', 'search', q] as const,
  splits:   ['social', 'splits'] as const,
  split:    (id: string) => ['social', 'split', id] as const,
  pools:    ['social', 'pools'] as const,
  pool:     (id: string) => ['social', 'pool', id] as const,
};

// ── Reads ────────────────────────────────────────────────────────────────────
export const useMyCashtag = () =>
  useQuery({ queryKey: KEYS.me, queryFn: api.getMyCashtag });

export const useActivity = () =>
  useQuery({ queryKey: KEYS.activity, queryFn: api.getActivity });

export const useContacts = () =>
  useQuery({ queryKey: KEYS.contacts, queryFn: api.getContacts });

export const useCashtagSearch = (query: string) =>
  useQuery({ queryKey: KEYS.search(query), queryFn: () => api.searchCashtags(query) });

export const useSplits = () =>
  useQuery({ queryKey: KEYS.splits, queryFn: api.listSplits });

export const useSplit = (id: string) =>
  useQuery({ queryKey: KEYS.split(id), queryFn: () => api.getSplit(id), enabled: !!id });

export const usePools = () =>
  useQuery({ queryKey: KEYS.pools, queryFn: api.listPools });

export const usePool = (id: string) =>
  useQuery({ queryKey: KEYS.pool(id), queryFn: () => api.getPool(id), enabled: !!id });

// resolveCashtag is invoked imperatively (on input change) — exported from api.
export { resolveCashtag } from './api';

// ── Mutations ────────────────────────────────────────────────────────────────
export function useSendMoney() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendInput) => api.sendMoney(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.activity });
      qc.invalidateQueries({ queryKey: KEYS.me });
    },
  });
}

export function useRequestMoney() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RequestInput) => api.requestMoney(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.activity }),
  });
}

export function useSetupCashtag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (handle: string) => api.setupCashtag(handle),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.me }),
  });
}

export function useCreateSplit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSplitInput) => api.createSplit(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.splits }),
  });
}

export function usePaySplitShare(splitId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, amountKobo }: { shareId: string; amountKobo: number }) =>
      api.paySplitShare(splitId, shareId, amountKobo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.split(splitId) });
      qc.invalidateQueries({ queryKey: KEYS.activity });
    },
  });
}

export function useCreatePool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePoolInput) => api.createPool(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.pools }),
  });
}

export function useContributeToPool(poolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountKobo: number) => api.contributeToPool(poolId, amountKobo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.pool(poolId) });
      qc.invalidateQueries({ queryKey: KEYS.activity });
    },
  });
}
