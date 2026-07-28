// Paymax Connect — Jobs React Query hooks (PRD §6.1 JB-*).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as jobsApi from './api';
import type { JobFilters, ApplyInput, OpenToWork } from './types';

export const jobsKeys = {
  all: ['connect', 'networking', 'jobs'] as const,
  list: (f: JobFilters) => [...jobsKeys.all, 'list', f] as const,
  detail: (id: string) => [...jobsKeys.all, 'detail', id] as const,
  resumes: () => [...jobsKeys.all, 'resumes'] as const,
  applications: () => [...jobsKeys.all, 'applications'] as const,
  openToWork: () => [...jobsKeys.all, 'open-to-work'] as const,
};

export function useJobs(filters: JobFilters) {
  return useQuery({ queryKey: jobsKeys.list(filters), queryFn: () => jobsApi.getJobs(filters) });
}

export function useJob(id: string) {
  return useQuery({ queryKey: jobsKeys.detail(id), queryFn: () => jobsApi.getJob(id), enabled: !!id });
}

export function useMyResumes() {
  return useQuery({ queryKey: jobsKeys.resumes(), queryFn: () => jobsApi.getMyResumes() });
}

export function useMyApplications() {
  return useQuery({ queryKey: jobsKeys.applications(), queryFn: () => jobsApi.getMyApplications() });
}

export function useApplyToJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ApplyInput) => jobsApi.applyToJob(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobsKeys.all }),
  });
}

export function useOpenToWork() {
  return useQuery({ queryKey: jobsKeys.openToWork(), queryFn: () => jobsApi.getOpenToWork() });
}

export function useSetOpenToWork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OpenToWork) => jobsApi.setOpenToWork(input),
    onSuccess: (data) => {
      qc.setQueryData(jobsKeys.openToWork(), data);
      qc.invalidateQueries({ queryKey: jobsKeys.openToWork() });
    },
  });
}
