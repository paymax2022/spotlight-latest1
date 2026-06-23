// ── Doctor — Batch 3 · Section N · lab result review hooks ─────────────────────
// Results inbox (+ new/critical flags, pending/ready/delayed states), rich result
// (PDF report ref, structured values with abnormal/critical flags, compare-with-
// previous timeseries, doctor interpretation + recommendation, audit trail) and
// the interpretation / repeat-test / share-explanation / report-suspicious
// mutations. Reads use the DEMO_* exports as placeholderData; mutations
// auto-generate the Idempotency-Key.
// REUSES Phase 1 `useLabResult`, `useMarkLabResultReviewed` (from `useClinical`)
// for the base result + mark-reviewed — those are NOT re-declared here.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getResultInbox,
  getLabResultRich,
  getLabValueComparisons,
  addInterpretation,
  requestRepeatTest,
  shareResultExplanation,
  reportSuspiciousResult,
  DEMO_RESULT_INBOX,
  DEMO_LAB_RESULT_RICH,
} from '@/api/doctor.batch3.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  AddInterpretationInput,
  RequestRepeatTestInput,
  ShareResultExplanationInput,
  ReportSuspiciousResultInput,
} from '@/types/doctor.batch3';

// ─── Reads ───────────────────────────────────────────────────────────────────

export function useResultInbox() {
  return useQuery({
    queryKey:        ['doctor', 'lab-result-inbox'],
    queryFn:         getResultInbox,
    placeholderData: DEMO_RESULT_INBOX,
    staleTime:       15_000,
  });
}

export function useLabResultRich(resultId: string) {
  return useQuery({
    queryKey:        ['doctor', 'lab-result-rich', resultId],
    queryFn:         () => getLabResultRich(resultId),
    enabled:         !!resultId,
    placeholderData: DEMO_LAB_RESULT_RICH,
    staleTime:       30_000,
  });
}

export function useLabValueComparisons(resultId: string) {
  return useQuery({
    queryKey:  ['doctor', 'lab-value-comparisons', resultId],
    queryFn:   () => getLabValueComparisons(resultId),
    enabled:   !!resultId,
    staleTime: 30_000,
  });
}

// ─── Mutations ─────────────────────────────────────────────────────────────────

export function useAddInterpretation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<AddInterpretationInput, 'idempotencyKey'>) =>
      addInterpretation({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'lab-result-rich', vars.resultId] });
    },
  });
}

export function useRequestRepeatTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RequestRepeatTestInput, 'idempotencyKey'>) =>
      requestRepeatTest({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'lab-orders'] });
    },
  });
}

export function useShareResultExplanation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ShareResultExplanationInput, 'idempotencyKey'>) =>
      shareResultExplanation({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'lab-result-rich', vars.resultId] });
    },
  });
}

export function useReportSuspiciousResult() {
  return useMutation({
    mutationFn: (input: Omit<ReportSuspiciousResultInput, 'idempotencyKey'>) =>
      reportSuspiciousResult({ ...input, idempotencyKey: generateIdempotencyKey() }),
  });
}
