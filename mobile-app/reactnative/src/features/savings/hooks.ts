import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import type { CreateVaultInput, CreateCircleInput, CreateGroupTargetInput } from './types';

const KEYS = {
  summary:  ['savings', 'summary'] as const,
  vaults:   ['savings', 'vaults'] as const,
  vault:    (id: string) => ['savings', 'vault', id] as const,
  earlyQuote: (id: string) => ['savings', 'vault', id, 'early-quote'] as const,
  circles:  ['savings', 'circles'] as const,
  discover: ['savings', 'circles', 'discover'] as const,
  circle:   (id: string) => ['savings', 'circle', id] as const,
  targets:  ['savings', 'targets'] as const,
  target:   (id: string) => ['savings', 'target', id] as const,
};

// ── Reads ────────────────────────────────────────────────────────────────────
export const useSavingsSummary = () =>
  useQuery({ queryKey: KEYS.summary, queryFn: api.getSummary });

export const useVaults = () =>
  useQuery({ queryKey: KEYS.vaults, queryFn: api.listVaults });

export const useVault = (id: string) =>
  useQuery({ queryKey: KEYS.vault(id), queryFn: () => api.getVault(id), enabled: !!id });

export const useEarlyWithdrawQuote = (id: string) =>
  useQuery({ queryKey: KEYS.earlyQuote(id), queryFn: () => api.getEarlyWithdrawQuote(id), enabled: !!id });

export const useCircles = () =>
  useQuery({ queryKey: KEYS.circles, queryFn: api.listCircles });

export const useDiscoverCircles = () =>
  useQuery({ queryKey: KEYS.discover, queryFn: api.discoverCircles });

export const useCircle = (id: string) =>
  useQuery({ queryKey: KEYS.circle(id), queryFn: () => api.getCircle(id), enabled: !!id });

export const useTargets = () =>
  useQuery({ queryKey: KEYS.targets, queryFn: api.listTargets });

export const useTarget = (id: string) =>
  useQuery({ queryKey: KEYS.target(id), queryFn: () => api.getTarget(id), enabled: !!id });

// ── Mutations ────────────────────────────────────────────────────────────────
export function useCreateVault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateVaultInput) => api.createVault(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.vaults });
      qc.invalidateQueries({ queryKey: KEYS.summary });
    },
  });
}

export function useFundVault(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountKobo: number) => api.fundVault(id, amountKobo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.vault(id) });
      qc.invalidateQueries({ queryKey: KEYS.vaults });
      qc.invalidateQueries({ queryKey: KEYS.summary });
    },
  });
}

export function useSetAutoSave(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (plan: { enabled: boolean; amountKobo: number; frequency: string }) => api.setAutoSave(id, plan),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.vault(id) }),
  });
}

export function useEarlyWithdraw(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.earlyWithdraw(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.vault(id) });
      qc.invalidateQueries({ queryKey: KEYS.vaults });
      qc.invalidateQueries({ queryKey: KEYS.summary });
    },
  });
}

export function useCreateCircle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCircleInput) => api.createCircle(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.circles });
      qc.invalidateQueries({ queryKey: KEYS.summary });
    },
  });
}

export function useContributeToCircle(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountKobo: number) => api.contributeToCircle(id, amountKobo),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.circle(id) }),
  });
}

export function useJoinCircle(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.joinCircle(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.circle(id) });
      qc.invalidateQueries({ queryKey: KEYS.discover });
    },
  });
}

export function useCreateGroupTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGroupTargetInput) => api.createGroupTarget(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.targets });
      qc.invalidateQueries({ queryKey: KEYS.summary });
    },
  });
}

export function useContributeToTarget(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountKobo: number) => api.contributeToTarget(id, amountKobo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.target(id) });
      qc.invalidateQueries({ queryKey: KEYS.summary });
    },
  });
}
