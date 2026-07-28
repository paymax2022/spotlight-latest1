// ── Spotlight Realtor — Lease / payment / move-in hooks (V2) ─────────────────
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as lease from '../api/realtorLease.api';
import type { SignLeaseDraft, PayInvoiceDraft } from '../types/realtor.lease.types';

const KEY = 'realtor-lease';

export function useLeaseByApplication(applicationId: string) {
  return useQuery({
    queryKey: [KEY, 'by-app', applicationId],
    queryFn: () => lease.getLeaseByApplication(applicationId),
    enabled: !!applicationId,
  });
}

export function useLease(id: string) {
  return useQuery({ queryKey: [KEY, 'lease', id], queryFn: () => lease.getLease(id), enabled: !!id });
}

export function useSignLease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: SignLeaseDraft) => lease.signLease(draft),
    onSuccess: (l) => qc.invalidateQueries({ queryKey: [KEY, 'lease', l.id] }),
  });
}

export function useInvoice(id: string) {
  return useQuery({ queryKey: [KEY, 'invoice', id], queryFn: () => lease.getInvoice(id), enabled: !!id });
}

export function usePayInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: PayInvoiceDraft) => lease.payInvoice(draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useEscrow(leaseId: string) {
  return useQuery({ queryKey: [KEY, 'escrow', leaseId], queryFn: () => lease.getEscrow(leaseId), enabled: !!leaseId });
}

export function useMoveIn(leaseId: string) {
  return useQuery({ queryKey: [KEY, 'movein', leaseId], queryFn: () => lease.getMoveIn(leaseId), enabled: !!leaseId });
}

export function useToggleMoveInItem(leaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => lease.toggleMoveInItem(leaseId, itemId),
    onSuccess: (mi) => qc.setQueryData([KEY, 'movein', leaseId], mi),
  });
}

export function useActivateOccupancy(leaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => lease.activateOccupancy(leaseId),
    onSuccess: (mi) => qc.setQueryData([KEY, 'movein', leaseId], mi),
  });
}
