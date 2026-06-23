// ── Doctor — Batch 2 · Section G · patient profile review hooks ────────────────
// The full patient profile (demographics, symptoms, allergy/surgery/family
// history, vitals timeseries, documents/images, previous consults/rx/labs, HMO,
// emergency contact, dependents, clinical alerts). Section G is read-only — the
// clinical alerts are derived data the screen renders as banners, not mutations.
// REUSES Phase 1 `usePatientProfile` for the base snapshot where a screen only
// needs the lightweight view; this hook layers the richer review data on top.

import { useQuery } from '@tanstack/react-query';
import {
  getPatientFullProfile,
  DEMO_PATIENT_FULL_PROFILE,
} from '@/api/doctor.batch2.api';

export function usePatientFullProfile(patientId: string) {
  return useQuery({
    queryKey:        ['doctor', 'patient-full-profile', patientId],
    queryFn:         () => getPatientFullProfile(patientId),
    enabled:         !!patientId,
    placeholderData: DEMO_PATIENT_FULL_PROFILE,
    staleTime:       30_000,
  });
}
