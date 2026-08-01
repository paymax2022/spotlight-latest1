// ── AI Trading — React Query hooks ───────────────────────────────────────────
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as tradingApi from './api';

export const TRADING_KEYS = {
  kyc: ['trading', 'kyc'] as const,
  position: ['trading', 'position'] as const,
  strategies: ['trading', 'strategies'] as const,
};

export const useStrategies = () =>
  useQuery({ queryKey: TRADING_KEYS.strategies, queryFn: tradingApi.fetchStrategies });

export const useKyc = () =>
  useQuery({ queryKey: TRADING_KEYS.kyc, queryFn: tradingApi.getKyc });

export function useSubmitKyc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => tradingApi.submitKyc(),
    onSuccess: () => qc.invalidateQueries({ queryKey: TRADING_KEYS.kyc }),
  });
}

export const usePosition = () =>
  useQuery({ queryKey: TRADING_KEYS.position, queryFn: tradingApi.getPosition });

export function useSubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountKobo: number) => tradingApi.subscribe(amountKobo),
    onSuccess: () => qc.invalidateQueries({ queryKey: TRADING_KEYS.position }),
  });
}

export function useRedeem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (units: number) => tradingApi.redeem(units),
    onSuccess: () => qc.invalidateQueries({ queryKey: TRADING_KEYS.position }),
  });
}
