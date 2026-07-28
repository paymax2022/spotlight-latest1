// ── Doctor — Ratings, Reviews & Reputation hooks (Batch 6, Section Z) ────────
// Query keys under ['doctor', 'reputation', …]. Mutations auto-generate the
// idempotencyKey. REUSES the Phase 2 useReputation / useReportReview
// (useReputation.ts) for the rating dashboard + report-review flow and the
// Phase 3 useQualityAnalytics for the trend tiles; this file adds per-consult
// feedback, the composite quality score, ranking insight, improvement
// recommendations and the review-dispute / removal flows. Hook names are distinct
// from useReputation to avoid a barrel collision.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getConsultationFeedback,
  getQualityScore,
  getRankingInsight,
  getImprovementRecommendations,
  getReviewDisputes,
  disputeReview,
  requestReviewRemoval,
  DEMO_CONSULT_FEEDBACK,
  DEMO_QUALITY_SCORE,
  DEMO_RANKING_INSIGHT,
  DEMO_IMPROVEMENT_RECOMMENDATIONS,
  DEMO_REVIEW_DISPUTES,
} from '@/api/doctor.batch6.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  DisputeReviewInput,
  RequestReviewRemovalInput,
} from '@/types/doctor.batch6';

// ─── Reads ────────────────────────────────────────────────────────────────────

export function useConsultationFeedback() {
  return useQuery({
    queryKey:        ['doctor', 'reputation', 'feedback'],
    queryFn:         getConsultationFeedback,
    placeholderData: DEMO_CONSULT_FEEDBACK,
    staleTime:       30_000,
  });
}

export function useQualityScore() {
  return useQuery({
    queryKey:        ['doctor', 'reputation', 'quality-score'],
    queryFn:         getQualityScore,
    placeholderData: DEMO_QUALITY_SCORE,
    staleTime:       60_000,
  });
}

export function useRankingInsight() {
  return useQuery({
    queryKey:        ['doctor', 'reputation', 'ranking'],
    queryFn:         getRankingInsight,
    placeholderData: DEMO_RANKING_INSIGHT,
    staleTime:       60_000,
  });
}

export function useImprovementRecommendations() {
  return useQuery({
    queryKey:        ['doctor', 'reputation', 'recommendations'],
    queryFn:         getImprovementRecommendations,
    placeholderData: DEMO_IMPROVEMENT_RECOMMENDATIONS,
    staleTime:       60_000,
  });
}

export function useReviewDisputes() {
  return useQuery({
    queryKey:        ['doctor', 'reputation', 'disputes'],
    queryFn:         getReviewDisputes,
    placeholderData: DEMO_REVIEW_DISPUTES,
    staleTime:       30_000,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useDisputeReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<DisputeReviewInput, 'idempotencyKey'>) =>
      disputeReview({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'reputation', 'disputes'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'reputation'] });
    },
  });
}

export function useRequestReviewRemoval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RequestReviewRemovalInput, 'idempotencyKey'>) =>
      requestReviewRemoval({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'reputation'] });
    },
  });
}
