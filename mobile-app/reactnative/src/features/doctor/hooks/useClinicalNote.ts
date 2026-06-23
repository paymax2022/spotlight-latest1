// ── Doctor — Batch 2 · Section J · clinical notes & diagnosis hooks ────────────
// The richer clinical note (SOAP + ICD codes, clinical impression, treatment
// plan, lifestyle recs, red flags, referral, follow-up, private notes) with a
// draft → finalize (locks) → share lifecycle. Diagnosis search is a pure
// client-side filter over the ICD-lite catalogue (re-exported here for the UI).
// REUSES Phase 1 `useSoapNote` / `useSaveSoapNote` from `useConsultation` for
// the plain SOAP path — those are not re-declared here.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getClinicalNote,
  saveDraftNote,
  finalizeNote,
  shareSummary,
  DEMO_CLINICAL_NOTE,
} from '@/api/doctor.batch2.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  SaveDraftNoteInput,
  FinalizeNoteInput,
  ShareSummaryInput,
} from '@/types/doctor.batch2';

// Re-export the pure diagnosis-search helper so screens can import it from the
// hooks barrel alongside the clinical-note hooks.
export { searchDiagnosisCodes } from '@/api/doctor.batch2.api';

export function useClinicalNote(appointmentId: string) {
  return useQuery({
    queryKey:        ['doctor', 'clinical-note', appointmentId],
    queryFn:         () => getClinicalNote(appointmentId),
    enabled:         !!appointmentId,
    placeholderData: DEMO_CLINICAL_NOTE,
    staleTime:       30_000,
  });
}

export function useSaveDraftNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SaveDraftNoteInput, 'idempotencyKey'>) =>
      saveDraftNote({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'clinical-note', vars.note.appointmentId] });
    },
  });
}

export function useFinalizeNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<FinalizeNoteInput, 'idempotencyKey'>) =>
      finalizeNote({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'clinical-note'] });
    },
  });
}

export function useShareSummary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ShareSummaryInput, 'idempotencyKey'>) =>
      shareSummary({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'clinical-note'] });
    },
  });
}
