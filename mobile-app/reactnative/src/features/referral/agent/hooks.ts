// ── Referral Agent / Team Zone React Query hooks (v5) — M-AGT-01..07 ─────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as agentApi from './api';
import { referralKeys } from '../foundation/hooks';

export const agentKeys = {
  dashboard: () => [...referralKeys.all, 'agent', 'dashboard'] as const,
  invites: () => [...referralKeys.all, 'agent', 'invites'] as const,
  members: () => [...referralKeys.all, 'agent', 'members'] as const,
  member: (id: string) => [...referralKeys.all, 'agent', 'member', id] as const,
  overrideLedger: () => [...referralKeys.all, 'agent', 'override-ledger'] as const,
  leaderboard: () => [...referralKeys.all, 'agent', 'leaderboard'] as const,
  training: () => [...referralKeys.all, 'agent', 'training'] as const,
  disclosure: () => [...referralKeys.all, 'agent', 'disclosure'] as const,
};

export function useTeamDashboard() {
  return useQuery({
    queryKey: agentKeys.dashboard(),
    queryFn: agentApi.getTeamDashboard,
    staleTime: 30_000,
  });
}

export function useTeamInvites() {
  return useQuery({
    queryKey: agentKeys.invites(),
    queryFn: agentApi.getTeamInvites,
    staleTime: 30_000,
  });
}

export function useOnboardSubReferrer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; contact: string }) => agentApi.onboardSubReferrer(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: agentKeys.invites() }),
  });
}

export function useTeamMembers() {
  return useQuery({
    queryKey: agentKeys.members(),
    queryFn: agentApi.getTeamMembers,
    staleTime: 30_000,
  });
}

export function useMemberDetail(id: string) {
  return useQuery({
    queryKey: agentKeys.member(id),
    queryFn: () => agentApi.getMemberDetail(id),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useOverrideLedger() {
  return useQuery({
    queryKey: agentKeys.overrideLedger(),
    queryFn: agentApi.getOverrideLedger,
    staleTime: 30_000,
  });
}

export function useTeamLeaderboard() {
  return useQuery({
    queryKey: agentKeys.leaderboard(),
    queryFn: agentApi.getTeamLeaderboard,
    staleTime: 60_000,
  });
}

export function useTraining() {
  return useQuery({
    queryKey: agentKeys.training(),
    queryFn: agentApi.getTraining,
    staleTime: 5 * 60_000,
  });
}

export function useAgentDisclosure() {
  return useQuery({
    queryKey: agentKeys.disclosure(),
    queryFn: agentApi.getAgentDisclosure,
    staleTime: 5 * 60_000,
  });
}

export function useAcceptAgentDisclosure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: string) => agentApi.acceptAgentDisclosure(version),
    onSuccess: () => qc.invalidateQueries({ queryKey: agentKeys.disclosure() }),
  });
}
