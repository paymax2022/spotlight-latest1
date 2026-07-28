// Paymax Connect — Skill Assessments React Query hooks (Phase 6 §6.7).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as assessmentsApi from './api';

export const assessmentKeys = {
  all: ['connect', 'networking', 'assessments'] as const,
  catalogue: (domain?: string) => [...assessmentKeys.all, 'catalogue', domain ?? ''] as const,
  badges: () => [...assessmentKeys.all, 'badges'] as const,
};

export function useAssessments(domain?: string) {
  return useQuery({
    queryKey: assessmentKeys.catalogue(domain),
    queryFn: () => assessmentsApi.getAssessments(domain),
  });
}

export function useAssessmentBadges() {
  return useQuery({ queryKey: assessmentKeys.badges(), queryFn: () => assessmentsApi.getAssessmentBadges() });
}

// Starts an attempt. Manual .mutate call (needs the returned attempt to drive
// the runner) — invalidates nothing until submit.
export function useStartAssessmentAttempt() {
  return useMutation({
    mutationFn: (v: { assessmentId: string; idempotencyKey?: string }) =>
      assessmentsApi.startAssessmentAttempt(v.assessmentId, v.idempotencyKey),
  });
}

export function useSubmitAssessmentAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { assessmentId: string; attemptId: string; answers: Record<string, string>; idempotencyKey?: string }) =>
      assessmentsApi.submitAssessmentAttempt(v.assessmentId, v.attemptId, v.answers, v.idempotencyKey),
    onSuccess: () => {
      // Passing issues a badge and clears cooldown; failing sets one — refresh both.
      qc.invalidateQueries({ queryKey: assessmentKeys.all });
    },
  });
}
