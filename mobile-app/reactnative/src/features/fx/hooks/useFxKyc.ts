// ── FX Exchange — KYC/KYB data hooks ─────────────────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as kyc from '../api/fxKyc.api';
import type { KycSubmission } from '../types/fx.types';

const KEY = 'fx-kyc';

export function useVerification() {
  return useQuery({ queryKey: [KEY, 'verification'], queryFn: kyc.getVerification, staleTime: 30_000 });
}

export function useSubmitKyc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (submission: KycSubmission) => kyc.submitKyc(submission),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useRestartKyc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => kyc.restartKyc(),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}
