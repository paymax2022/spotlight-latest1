// ── Doctor — practice-management hooks ───────────────────────────────────────
// Phase 3. Doctor quality analytics (reads only) + multi-clinic / provider
// management (portfolio read, active-clinic switch, per-clinic schedule edit).
// Reads use DEMO_* as placeholderData; mutations auto-generate the Idempotency-Key.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getQualityAnalytics,
  getClinicPortfolio,
  setActiveClinic,
  updateClinicSchedule,
  DEMO_QUALITY_ANALYTICS,
  DEMO_CLINIC_PORTFOLIO,
} from '@/api/doctor.phase3.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  AnalyticsPeriod,
  SetActiveClinicInput,
  UpdateClinicScheduleInput,
} from '@/types/doctor.phase3';

// ─── 9. Quality analytics (reads only) ───────────────────────────────────────

export function useQualityAnalytics(period?: AnalyticsPeriod) {
  return useQuery({
    queryKey:        ['doctor', 'analytics', period ?? '30d'],
    queryFn:         () => getQualityAnalytics(period),
    placeholderData: DEMO_QUALITY_ANALYTICS,
    staleTime:       60_000,
  });
}

// ─── 10. Multi-clinic / provider management ──────────────────────────────────

export function useClinicPortfolio() {
  return useQuery({
    queryKey:        ['doctor', 'clinics', 'portfolio'],
    queryFn:         getClinicPortfolio,
    placeholderData: DEMO_CLINIC_PORTFOLIO,
    staleTime:       30_000,
  });
}

export function useSetActiveClinic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SetActiveClinicInput, 'idempotencyKey'>) =>
      setActiveClinic({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'clinics', 'portfolio'] });
    },
  });
}

export function useUpdateClinicSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<UpdateClinicScheduleInput, 'idempotencyKey'>) =>
      updateClinicSchedule({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'clinics', 'portfolio'] });
    },
  });
}
