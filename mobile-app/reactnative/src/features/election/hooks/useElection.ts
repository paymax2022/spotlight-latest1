import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateIdempotencyKey } from '@/utils/idempotency';
import * as api from '../api/election.api';

export const electionKeys = {
  all: ['election'] as const,
  active: () => [...electionKeys.all, 'active'] as const,
  list: () => [...electionKeys.all, 'list'] as const,
  detail: (id: string) => [...electionKeys.all, 'detail', id] as const,
  eligibility: (id: string) => [...electionKeys.all, 'eligibility', id] as const,
  ballot: (id: string) => [...electionKeys.all, 'ballot', id] as const,
};

/**
 * The currently-open election (or null). Polls so the header banner switches on
 * automatically at the admin-set start time and off at the end — no app restart.
 */
export function useActiveElection() {
  return useQuery({
    queryKey: electionKeys.active(),
    queryFn: api.getActiveElection,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

export function useElections() {
  return useQuery({ queryKey: electionKeys.list(), queryFn: api.listElections });
}

export function useElection(id: string) {
  return useQuery({
    queryKey: electionKeys.detail(id),
    queryFn: () => api.getElection(id),
    enabled: !!id,
    refetchInterval: 30_000,
  });
}

export function useVoterEligibility(id: string) {
  return useQuery({
    queryKey: electionKeys.eligibility(id),
    queryFn: () => api.getVoterEligibility(id),
    enabled: !!id,
  });
}

export function useMyBallot(id: string) {
  return useQuery({
    queryKey: electionKeys.ballot(id),
    queryFn: () => api.getMyBallot(id),
    enabled: !!id,
  });
}

export function useCreateElection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      title: string;
      description?: string;
      startsAt: string;
      endsAt: string;
      positions: { title: string; seats: number; candidateNames: string[] }[];
    }) => api.createElection({ ...vars, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: electionKeys.list() });
      qc.invalidateQueries({ queryKey: electionKeys.active() });
    },
  });
}

export function usePublishResults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (electionId: string) => api.publishResults(electionId),
    onSuccess: (_data, electionId) => {
      qc.invalidateQueries({ queryKey: electionKeys.detail(electionId) });
      qc.invalidateQueries({ queryKey: electionKeys.list() });
    },
  });
}

export function useCastVote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { electionId: string; positionId: string; candidateId: string }) =>
      api.castVote({ ...vars, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: electionKeys.detail(vars.electionId) });
      qc.invalidateQueries({ queryKey: electionKeys.ballot(vars.electionId) });
      qc.invalidateQueries({ queryKey: electionKeys.active() });
    },
  });
}
