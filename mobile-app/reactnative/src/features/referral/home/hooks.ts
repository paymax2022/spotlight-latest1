// ── Referral Home React Query hooks (v5) ─────────────────────────────────────

import { useQuery } from '@tanstack/react-query';
import * as homeApi from './api';
import { referralKeys } from '../foundation/hooks';

export const homeKeys = {
  dashboard: () => [...referralKeys.all, 'home', 'dashboard'] as const,
  myCode: () => [...referralKeys.all, 'home', 'code'] as const,
  activity: () => [...referralKeys.all, 'home', 'activity'] as const,
};

export function useDashboard() {
  return useQuery({ queryKey: homeKeys.dashboard(), queryFn: homeApi.getDashboard });
}

export function useMyCode() {
  return useQuery({ queryKey: homeKeys.myCode(), queryFn: homeApi.getMyCode });
}

export function useActivity() {
  return useQuery({ queryKey: homeKeys.activity(), queryFn: homeApi.getActivity });
}
