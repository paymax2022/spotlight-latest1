// ── Doctor — ratings/reviews & payout report hooks ───────────────────────────
// Phase 2. Reputation/reviews reads + report-unfair-review mutation, plus the
// payout report read (extends Phase 1 earnings; reads only).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getReputation,
  getPayoutReport,
  reportReview,
  DEMO_REPUTATION,
  DEMO_PAYOUT_REPORT,
} from '@/api/doctor.phase2.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { ReportReviewInput } from '@/types/doctor.phase2';

// ─── Ratings & reviews ───────────────────────────────────────────────────────

export function useReputation() {
  return useQuery({
    queryKey:        ['doctor', 'reputation'],
    queryFn:         getReputation,
    placeholderData: DEMO_REPUTATION,
    staleTime:       30_000,
  });
}

export function useReportReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ReportReviewInput, 'idempotencyKey'>) =>
      reportReview({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'reputation'] });
    },
  });
}

// ─── Payout report (extends earnings; reads only) ────────────────────────────

export function usePayoutReport(rangeLabel?: string) {
  return useQuery({
    queryKey:        ['doctor', 'payout-report', rangeLabel],
    queryFn:         () => getPayoutReport(rangeLabel),
    placeholderData: DEMO_PAYOUT_REPORT,
    staleTime:       60_000,
  });
}
