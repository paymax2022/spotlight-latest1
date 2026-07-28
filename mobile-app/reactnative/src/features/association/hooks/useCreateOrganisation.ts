// ── Association — Organisation publish hook (U) ───────────────────────────────

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { publishOrganisation } from '../api/orgCreate.api';
import type { OrgDraft } from '../types/orgDraft.types';

export function useCreateOrganisation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: OrgDraft) => publishOrganisation(draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['association', 'orgs'] }),
  });
}
