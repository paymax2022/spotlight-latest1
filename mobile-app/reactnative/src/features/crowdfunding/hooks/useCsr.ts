// ── Crowdfunding — Corporate CSR (Section M) hooks ───────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCsrProfile, getMatchableCampaigns, getMatchableCampaign, getMatches,
  setupMatch, approveMatch, getInvoices, getImpactSummary, getEmployeeGiving,
} from '../api/csr.api';
import type { MatchSetupInput } from '../types/csr.types';

const KEY = 'crowdfunding';

export function useCsrProfile() {
  return useQuery({ queryKey: [KEY, 'csr', 'profile'], queryFn: getCsrProfile, staleTime: 30_000 });
}
export function useMatchableCampaigns() {
  return useQuery({ queryKey: [KEY, 'csr', 'campaigns'], queryFn: getMatchableCampaigns, staleTime: 30_000 });
}
export function useMatchableCampaign(id?: string) {
  return useQuery({ queryKey: [KEY, 'csr', 'campaign', id], queryFn: () => getMatchableCampaign(id as string), enabled: Boolean(id), staleTime: 30_000 });
}
export function useMatches() {
  return useQuery({ queryKey: [KEY, 'csr', 'matches'], queryFn: getMatches, staleTime: 15_000 });
}
export function useSetupMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MatchSetupInput) => setupMatch(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY, 'csr', 'matches'] }); qc.invalidateQueries({ queryKey: [KEY, 'csr', 'profile'] }); },
  });
}
export function useApproveMatch() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (matchId: string) => approveMatch(matchId), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'csr', 'matches'] }) });
}
export function useInvoices() {
  return useQuery({ queryKey: [KEY, 'csr', 'invoices'], queryFn: getInvoices, staleTime: 60_000 });
}
export function useImpactSummary() {
  return useQuery({ queryKey: [KEY, 'csr', 'impact'], queryFn: getImpactSummary, staleTime: 60_000 });
}
export function useEmployeeGiving() {
  return useQuery({ queryKey: [KEY, 'csr', 'employee-giving'], queryFn: getEmployeeGiving, staleTime: 60_000 });
}
