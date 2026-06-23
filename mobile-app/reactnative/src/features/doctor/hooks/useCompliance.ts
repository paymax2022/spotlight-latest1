// ── Doctor — compliance dashboard hooks ──────────────────────────────────────
// Phase 2. Licence/consent/audit/alerts/policy reads + acknowledge-policy
// mutation (auto-generates idempotencyKey, invalidates the dashboard).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getComplianceDashboard,
  acknowledgePolicy,
  DEMO_COMPLIANCE,
} from '@/api/doctor.phase2.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { AcknowledgePolicyInput } from '@/types/doctor.phase2';

export function useComplianceDashboard() {
  return useQuery({
    queryKey:        ['doctor', 'compliance'],
    queryFn:         getComplianceDashboard,
    placeholderData: DEMO_COMPLIANCE,
    staleTime:       30_000,
  });
}

export function useAcknowledgePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<AcknowledgePolicyInput, 'idempotencyKey'>) =>
      acknowledgePolicy({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'compliance'] });
    },
  });
}
