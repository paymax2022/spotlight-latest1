// ── Doctor — AI assistance hooks ─────────────────────────────────────────────
// Phase 3. The three AI screens: consultation-note summary, prescription safety
// checker, and lab-result explanation. Each AI result is wrapped in the shared
// `AiEnvelope<T>` (status: idle | generating | ready | error). The "generating"
// transition is surfaced via the mutation's `isPending`; the resolved value is
// the ready envelope. Generate mutations carry an auto-generated Idempotency-Key.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAiNoteSummary,
  getAiSafetyReport,
  getAiLabExplanation,
  generateAiNoteSummary,
  acceptAiNoteSummary,
  checkPrescriptionSafety,
  explainLabResult,
} from '@/api/doctor.phase3.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  GenerateAiNoteSummaryInput,
  AcceptAiNoteSummaryInput,
  CheckPrescriptionSafetyInput,
  ExplainLabResultInput,
} from '@/types/doctor.phase3';

// ─── 6. AI consultation note summary ─────────────────────────────────────────

// Read the last-generated summary for a consult (if any). Returns the ready
// envelope; pair with `useGenerateAiNoteSummary` to (re)generate.
export function useAiNoteSummary(appointmentId: string) {
  return useQuery({
    queryKey:  ['doctor', 'ai', 'note-summary', appointmentId],
    queryFn:   () => getAiNoteSummary(appointmentId),
    enabled:   !!appointmentId,
    staleTime: 0, // AI output is per-run; do not cache stale generations
  });
}

// Generate / regenerate. `isPending` represents the 'generating' state; the
// settled data/error maps to 'ready'/'error'.
export function useGenerateAiNoteSummary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<GenerateAiNoteSummaryInput, 'idempotencyKey'>) =>
      generateAiNoteSummary({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (data, vars) => {
      qc.setQueryData(['doctor', 'ai', 'note-summary', vars.appointmentId], data);
    },
  });
}

// Accept the (possibly edited) draft — persists it as a SoapNote in Phase C.
export function useAcceptAiNoteSummary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<AcceptAiNoteSummaryInput, 'idempotencyKey'>) =>
      acceptAiNoteSummary({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'ai', 'note-summary', vars.appointmentId] });
    },
  });
}

// ─── 7. AI prescription safety checker ───────────────────────────────────────

// Run a safety analysis over a prescription draft. No persistence — the result
// is held in mutation state (`data`/`isPending`/`isError`).
export function useCheckPrescriptionSafety() {
  return useMutation({
    mutationFn: (input: Omit<CheckPrescriptionSafetyInput, 'idempotencyKey'>) =>
      checkPrescriptionSafety({ ...input, idempotencyKey: generateIdempotencyKey() }),
  });
}

// Read a previously-computed safety report by id (e.g. attached to a draft).
export function useAiSafetyReport(id: string) {
  return useQuery({
    queryKey:  ['doctor', 'ai', 'rx-safety', id],
    queryFn:   () => getAiSafetyReport(id),
    enabled:   !!id,
    staleTime: 0,
  });
}

// ─── 8. AI lab result explanation ────────────────────────────────────────────

// Read the cached explanation for a lab result, if present.
export function useAiLabExplanation(resultId: string) {
  return useQuery({
    queryKey:  ['doctor', 'ai', 'lab-explanation', resultId],
    queryFn:   () => getAiLabExplanation(resultId),
    enabled:   !!resultId,
    staleTime: 0,
  });
}

// Generate / regenerate the plain-language explanation for a lab result.
export function useExplainLabResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ExplainLabResultInput, 'idempotencyKey'>) =>
      explainLabResult({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (data, vars) => {
      qc.setQueryData(['doctor', 'ai', 'lab-explanation', vars.resultId], data);
    },
  });
}
