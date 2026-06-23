// ── Spotlight Realtor — Data hooks ───────────────────────────────────────────
// React Query hooks mirroring useFx.ts so screens stay declarative and share the
// caching / loading / error contracts used across the app.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as realtor from '../api/realtor.api';
import type {
  ListingFilter,
  InspectionDraft,
  ApplicationDraft,
} from '../types/realtor.types';

const KEY = 'realtor';

// ─── Discovery ────────────────────────────────────────────────────────────────

export function useMarketplaceHome() {
  return useQuery({ queryKey: [KEY, 'home'], queryFn: realtor.getMarketplaceHome, staleTime: 30_000 });
}

export function useSearchListings(filter: ListingFilter) {
  return useQuery({
    queryKey: [KEY, 'search', filter],
    queryFn: () => realtor.searchListings(filter),
    staleTime: 15_000,
  });
}

export function useListing(id: string) {
  return useQuery({
    queryKey: [KEY, 'listing', id],
    queryFn: () => realtor.getListing(id),
    enabled: !!id,
  });
}

export function useSimilarListings(id: string) {
  return useQuery({
    queryKey: [KEY, 'similar', id],
    queryFn: () => realtor.getSimilarListings(id),
    enabled: !!id,
    staleTime: 60_000,
  });
}

// ─── Inspection booking ───────────────────────────────────────────────────────

export function useInspectionSlots(listingId: string) {
  return useQuery({
    queryKey: [KEY, 'slots', listingId],
    queryFn: () => realtor.getInspectionSlots(listingId),
    enabled: !!listingId,
    staleTime: 30_000,
  });
}

export function useCreateInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: InspectionDraft) => realtor.createInspection(draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'inspections'] }),
  });
}

export function useInspections() {
  return useQuery({ queryKey: [KEY, 'inspections'], queryFn: realtor.getInspections, staleTime: 15_000 });
}

export function useInspection(id: string) {
  return useQuery({
    queryKey: [KEY, 'inspection', id],
    queryFn: () => realtor.getInspection(id),
    enabled: !!id,
  });
}

export function useCancelInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => realtor.cancelInspection(id),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: [KEY, 'inspections'] });
      qc.invalidateQueries({ queryKey: [KEY, 'inspection', b.id] });
    },
  });
}

// ─── Rental application ───────────────────────────────────────────────────────

export function useCreateApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: ApplicationDraft) => realtor.createApplication(draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'applications'] }),
  });
}

export function useApplications() {
  return useQuery({ queryKey: [KEY, 'applications'], queryFn: realtor.getApplications, staleTime: 15_000 });
}

export function useApplication(id: string) {
  return useQuery({
    queryKey: [KEY, 'application', id],
    queryFn: () => realtor.getApplication(id),
    enabled: !!id,
  });
}
