// ── Arena (Driver Contest) — data hooks ──────────────────────────────────────
// React Query wrappers over the /api/arena contract. Reads are offline-tolerant
// (cached + "last updated" derived from `updatedAt`); mutations invalidate the
// queries they affect. Money/engagement mutations delegate idempotency to api.ts.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as arena from './api';
import type { PredictionPick } from './types';

const KEY = 'arena';

// ─── Public reads ────────────────────────────────────────────────────────────

export function useCompetitions() {
  return useQuery({
    queryKey: [KEY, 'competitions'],
    queryFn: arena.listCompetitions,
    staleTime: 60_000,
  });
}

export function useCompetition(id: string | null | undefined) {
  return useQuery({
    queryKey: [KEY, 'competition', id],
    queryFn: () => arena.getCompetition(id as string),
    enabled: !!id,
    staleTime: 30_000,
  });
}

/** The REAL ranking (NDC-1). Polls while a competition is live. */
export function useMeritLeaderboard(id: string | null | undefined, pollMs?: number) {
  return useQuery({
    queryKey: [KEY, 'merit-leaderboard', id],
    queryFn: () => arena.getMeritLeaderboard(id as string),
    enabled: !!id,
    refetchInterval: pollMs && id ? pollMs : false,
    staleTime: 10_000,
  });
}

export function usePot(id: string | null | undefined) {
  return useQuery({
    queryKey: [KEY, 'pot', id],
    queryFn: () => arena.getPot(id as string),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useStatePride(id: string | null | undefined) {
  return useQuery({
    queryKey: [KEY, 'state-pride', id],
    queryFn: () => arena.getStatePride(id as string),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useDriverProfile(competitionId: string | null | undefined, contestantId: string | null | undefined) {
  return useQuery({
    queryKey: [KEY, 'driver', competitionId, contestantId],
    queryFn: () => arena.getDriverProfile(competitionId as string, contestantId as string),
    enabled: !!competitionId && !!contestantId,
    staleTime: 15_000,
  });
}

export function useVerifyCredential(hash: string | null | undefined) {
  return useQuery({
    queryKey: [KEY, 'credential', hash],
    queryFn: () => arena.verifyCredential(hash as string),
    enabled: !!hash,
    staleTime: 60_000,
  });
}

// ─── Member reads ────────────────────────────────────────────────────────────

/** The signed-in user's contestant record — drives the Compete tab state machine. */
export function useMe(competitionId: string | null | undefined, pollMs?: number) {
  return useQuery({
    queryKey: [KEY, 'me', competitionId],
    queryFn: () => arena.getMe(competitionId as string),
    enabled: !!competitionId,
    refetchInterval: pollMs && competitionId ? pollMs : false,
    staleTime: 10_000,
  });
}

export function useMyMerit(competitionId: string | null | undefined) {
  return useQuery({
    queryKey: [KEY, 'my-merit', competitionId],
    queryFn: () => arena.getMyMerit(competitionId as string),
    enabled: !!competitionId,
    staleTime: 15_000,
  });
}

export function useTraining(competitionId: string | null | undefined) {
  return useQuery({
    queryKey: [KEY, 'training', competitionId],
    queryFn: () => arena.getTraining(competitionId as string),
    enabled: !!competitionId,
    staleTime: 30_000,
  });
}

export function usePlayAlongQuestions(competitionId: string | null | undefined, category: string) {
  return useQuery({
    queryKey: [KEY, 'playalong-questions', competitionId, category],
    queryFn: () => arena.getPlayAlongQuestions(competitionId as string, category),
    enabled: !!competitionId && !!category,
    staleTime: 60_000,
  });
}

/** C6 exam feed — ONLINE-REQUIRED, no cache retry (network failure must surface). */
export function useExamQuestions(competitionId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [KEY, 'exam-questions', competitionId],
    queryFn: () => arena.getExamQuestions(competitionId as string),
    enabled: !!competitionId && enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export function useSubmitApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: arena.submitApplication,
    onSuccess: (_c, input) =>
      qc.invalidateQueries({ queryKey: [KEY, 'me', input.competitionId] }),
  });
}

/** Back-a-Driver (S5). Money mutation — idempotency handled in api.ts. */
export function useSupport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: arena.support,
    onSuccess: (_c, input) => {
      qc.invalidateQueries({ queryKey: [KEY, 'pot', input.competitionId] });
      qc.invalidateQueries({ queryKey: [KEY, 'driver', input.competitionId, input.contestantId] });
    },
  });
}

/** Play-Along attempt (S2). Engagement mutation — never Merit. */
export function useSubmitPlayAlong() {
  return useMutation({ mutationFn: arena.submitPlayAlong });
}

export function useSubmitPredictions() {
  return useMutation({
    mutationFn: (input: { competitionId: string; picks: PredictionPick[] }) =>
      arena.submitPredictions(input),
  });
}

/** C6 exam submit → THEORY_TAKEN. Idempotent (one attempt per batch). */
export function useSubmitExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: arena.submitExam,
    onSuccess: (_c, input) =>
      qc.invalidateQueries({ queryKey: [KEY, 'me', input.competitionId] }),
  });
}
