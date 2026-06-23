// ── Spotlight Realtor — Maintenance hooks (V2) ───────────────────────────────
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as m from '../api/realtorMaintenance.api';
import type { NewMaintenanceDraft, QuoteDraft } from '../types/realtor.maintenance.types';

const KEY = 'realtor-maint';

export function useMaintenanceRequests() {
  return useQuery({ queryKey: [KEY, 'list'], queryFn: m.listRequests, staleTime: 15_000 });
}
export function useMaintenanceRequest(id: string) {
  return useQuery({ queryKey: [KEY, 'req', id], queryFn: () => m.getRequest(id), enabled: !!id });
}
export function useVendorJobs() {
  return useQuery({ queryKey: [KEY, 'jobs'], queryFn: m.listVendorJobs, staleTime: 15_000 });
}

function useTransition<TArgs, TResult>(fn: (a: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'list'] });
      qc.invalidateQueries({ queryKey: [KEY, 'jobs'] });
      qc.invalidateQueries({ queryKey: [KEY, 'req'] });
    },
  });
}

export const useCreateMaintenance = () => useTransition((d: NewMaintenanceDraft) => m.createRequest(d));
export const useApproveQuote = () => useTransition((id: string) => m.approveQuote(id));
export const useRejectQuote = () => useTransition((id: string) => m.rejectQuote(id));
export const useConfirmCompletion = () => useTransition((id: string) => m.confirmCompletion(id));
export const useCancelRequest = () => useTransition((id: string) => m.cancelRequest(id));
export const useRateRequest = () => useTransition((args: { id: string; rating: number }) => m.rateRequest(args.id, args.rating));

export const useAcceptJob = () => useTransition((id: string) => m.acceptJob(id));
export const useSubmitQuote = () => useTransition((d: QuoteDraft) => m.submitQuote(d));
export const useStartJob = () => useTransition((id: string) => m.startJob(id));
export const useCompleteJob = () => useTransition((args: { id: string; evidenceUris: string[] }) => m.completeJob(args.id, args.evidenceUris));
