// ── Doctor — earnings & payout hooks ─────────────────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getEarnings, requestPayout, DEMO_EARNINGS } from '@/api/doctor.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { RequestPayoutInput } from '@/types/doctor';

export function useEarnings() {
  return useQuery({
    queryKey:        ['doctor', 'earnings'],
    queryFn:         getEarnings,
    placeholderData: DEMO_EARNINGS,
    staleTime:       30_000,
  });
}

export function useRequestPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RequestPayoutInput, 'idempotencyKey'>) =>
      requestPayout({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'earnings'] });
    },
  });
}
