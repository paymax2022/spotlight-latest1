import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import type { RedeemInput } from './types';

const KEYS = {
  account: ['loyalty', 'account'] as const,
  ledger:  ['loyalty', 'ledger'] as const,
  catalog: ['loyalty', 'catalog'] as const,
  tiers:   ['loyalty', 'tiers'] as const,
};

// ── Reads ──────────────────────────────────────────────────────────────────────
export const useLoyaltyAccount = () =>
  useQuery({ queryKey: KEYS.account, queryFn: api.getAccount });

export const usePointsLedger = () =>
  useQuery({ queryKey: KEYS.ledger, queryFn: api.getLedger });

export const useCatalog = () =>
  useQuery({ queryKey: KEYS.catalog, queryFn: api.getCatalog });

export const useTiers = () =>
  useQuery({ queryKey: KEYS.tiers, queryFn: api.getTiers });

// ── Mutations ────────────────────────────────────────────────────────────────
export function useRedeem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RedeemInput) => api.redeem(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.account });
      qc.invalidateQueries({ queryKey: KEYS.ledger });
    },
  });
}
