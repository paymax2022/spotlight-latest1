// ── Doctor — specialist referral hooks ───────────────────────────────────────
// Phase 2. Query keys under ['doctor', …]; create mutation auto-generates the
// idempotencyKey and invalidates the referral list.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getSpecialists,
  getReferrals,
  getReferral,
  createReferral,
  DEMO_SPECIALISTS,
  DEMO_REFERRALS,
} from '@/api/doctor.phase2.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  ReferralStatus,
  CreateReferralInput,
} from '@/types/doctor.phase2';

export function useSpecialists(specialty?: string) {
  return useQuery({
    queryKey:        ['doctor', 'specialists', specialty],
    queryFn:         () => getSpecialists(specialty),
    placeholderData: DEMO_SPECIALISTS,
    staleTime:       60_000,
  });
}

export function useReferrals(status?: ReferralStatus) {
  return useQuery({
    queryKey:        ['doctor', 'referrals', status],
    queryFn:         () => getReferrals(status),
    placeholderData: DEMO_REFERRALS,
    staleTime:       30_000,
  });
}

export function useReferral(id: string) {
  return useQuery({
    queryKey: ['doctor', 'referral', id],
    queryFn:  () => getReferral(id),
    enabled:  !!id,
    staleTime: 30_000,
  });
}

export function useCreateReferral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateReferralInput, 'idempotencyKey'>) =>
      createReferral({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'referrals'] });
    },
  });
}
