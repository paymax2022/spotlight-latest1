import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import type {
  TipInput,
  SubscribeInput,
  BecomeCreatorInput,
  PayoutInput,
  CreateContentInput,
} from './types';

const KEYS = {
  creators:      (q: string) => ['creators', 'list', q] as const,
  storefront:    (id: string) => ['creators', 'storefront', id] as const,
  content:       (id: string) => ['creators', 'content', id] as const,
  myContent:     ['creators', 'me', 'content'] as const,
  subscriptions: ['creators', 'me', 'subscriptions'] as const,
  earnings:      ['creators', 'me', 'earnings'] as const,
};

// ── Reads ────────────────────────────────────────────────────────────────────
export const useCreators = (query = '') =>
  useQuery({ queryKey: KEYS.creators(query), queryFn: () => api.listCreators(query) });

export const useStorefront = (id: string) =>
  useQuery({ queryKey: KEYS.storefront(id), queryFn: () => api.getStorefront(id), enabled: !!id });

export const useContent = (id: string) =>
  useQuery({ queryKey: KEYS.content(id), queryFn: () => api.getContent(id), enabled: !!id });

export const useMyContent = () =>
  useQuery({ queryKey: KEYS.myContent, queryFn: api.listMyContent });

export const useSubscriptions = () =>
  useQuery({ queryKey: KEYS.subscriptions, queryFn: api.listSubscriptions });

export const useEarnings = () =>
  useQuery({ queryKey: KEYS.earnings, queryFn: api.getEarnings });

// ── Mutations ────────────────────────────────────────────────────────────────
export function useSendTip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TipInput) => api.sendTip(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.earnings }),
  });
}

export function useSubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubscribeInput) => api.subscribe(input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: KEYS.subscriptions });
      qc.invalidateQueries({ queryKey: KEYS.storefront(vars.creatorId) });
    },
  });
}

export function useCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (subId: string) => api.cancelSubscription(subId),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.subscriptions }),
  });
}

export function useUnlockContent(contentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.unlockContent(contentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.content(contentId) }),
  });
}

export function useBecomeCreator() {
  return useMutation({
    mutationFn: (input: BecomeCreatorInput) => api.becomeCreator(input),
  });
}

export function useRequestPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PayoutInput) => api.requestPayout(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.earnings }),
  });
}

export function useCompletePayoutKyc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ legalName, kycRef }: { legalName: string; kycRef: string }) =>
      api.completePayoutKyc(legalName, kycRef),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.earnings }),
  });
}

export function useCreateContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateContentInput) => api.createContent(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.myContent }),
  });
}
