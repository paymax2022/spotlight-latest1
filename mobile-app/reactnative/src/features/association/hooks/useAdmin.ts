// ── Association — Admin-lite hooks (Q/R/S/T) ──────────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAdminKpis, getApprovalQueue, getApplication, decideApplication,
  getFinanceSummary, getOfflinePayments, decideOfflinePayment,
  getImportPreview, confirmImport, getAuditLog,
} from '../api/admin.api';
import type { ApplicationJurisdiction, ApprovalDecision } from '../types/admin.types';
import type { PickedFile } from '../utils/docPicker';

const KEY = 'association';

export function useAdminKpis() {
  return useQuery({ queryKey: [KEY, 'adminKpis'], queryFn: getAdminKpis, staleTime: 30_000 });
}

export function useApprovalQueue(jurisdiction: ApplicationJurisdiction | 'ALL' = 'ALL') {
  return useQuery({ queryKey: [KEY, 'approvals', jurisdiction], queryFn: () => getApprovalQueue(jurisdiction), staleTime: 20_000 });
}

export function useApplication(id?: string) {
  return useQuery({
    queryKey: [KEY, 'application', id],
    queryFn: () => getApplication(id as string),
    enabled: Boolean(id),
    staleTime: 20_000,
  });
}

export function useDecideApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: ApprovalDecision; note?: string }) =>
      decideApplication(id, decision, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'approvals'] });
      qc.invalidateQueries({ queryKey: [KEY, 'adminKpis'] });
    },
  });
}

export function useFinanceSummary() {
  return useQuery({ queryKey: [KEY, 'finance'], queryFn: getFinanceSummary, staleTime: 30_000 });
}

export function useOfflinePayments() {
  return useQuery({ queryKey: [KEY, 'offlinePayments'], queryFn: getOfflinePayments, staleTime: 15_000 });
}

export function useDecideOfflinePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => decideOfflinePayment(id, approve),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'offlinePayments'] });
      qc.invalidateQueries({ queryKey: [KEY, 'finance'] });
    },
  });
}

export function useAuditLog(action: string = 'all') {
  return useQuery({ queryKey: [KEY, 'auditLog', action], queryFn: () => getAuditLog(action), staleTime: 20_000 });
}

/** Cache key the preview screen reads the uploaded dry-run from. */
export const IMPORT_PREVIEW_KEY = [KEY, 'importPreview'] as const;

export function useImportPreview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, orgId }: { file: PickedFile; orgId?: string }) => getImportPreview(file, orgId),
    // The preview screen cannot re-fetch (multipart endpoint, no file in hand),
    // so hand it the result through the cache.
    onSuccess: (data) => qc.setQueryData(IMPORT_PREVIEW_KEY, data),
  });
}

export function useConfirmImport() {
  return useMutation({ mutationFn: (sendInvites: boolean) => confirmImport(sendInvites) });
}
