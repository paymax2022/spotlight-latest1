import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import type { JobStatus, OnboardVendorInput } from './api';

export const vendorKeys = {
  all: ['vendors'] as const,
  list: () => [...vendorKeys.all, 'list'] as const,
  jobs: () => [...vendorKeys.all, 'jobs'] as const,
  earnings: () => [...vendorKeys.all, 'earnings'] as const,
};

export function useVendors() { return useQuery({ queryKey: vendorKeys.list(), queryFn: api.listVendors }); }
export function useVendorJobs() { return useQuery({ queryKey: vendorKeys.jobs(), queryFn: api.listJobs }); }
export function useVendorEarnings() { return useQuery({ queryKey: vendorKeys.earnings(), queryFn: api.getVendorEarnings }); }

export function useUpdateJobStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: JobStatus }) => api.updateJobStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: vendorKeys.jobs() }),
  });
}

export function useOnboardVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OnboardVendorInput) => api.onboardVendor(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: vendorKeys.all }),
  });
}
