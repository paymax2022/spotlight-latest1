// ── Paymax Stays — React Query v5 hooks ──────────────────────────────────────
// Thin query/mutation wrappers over the api layer so screens never call fetch
// directly and cache keys stay consistent.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import type {
  BookInput,
  PrebookInput,
  SearchQuery,
  StaysFilter,
} from './types';

const KEY = 'stays';

export function useStaysHome() {
  return useQuery({ queryKey: [KEY, 'home'], queryFn: api.getStaysHome, staleTime: 30_000 });
}

export function useDestinations(q: string) {
  return useQuery({
    queryKey: [KEY, 'destinations', q],
    queryFn: () => api.searchDestinations(q),
    staleTime: 60_000,
  });
}

export function useDeals() {
  return useQuery({ queryKey: [KEY, 'deals'], queryFn: api.getDeals, staleTime: 60_000 });
}

export function useSearchStays(query: SearchQuery, filter: StaysFilter, enabled = true) {
  return useQuery({
    queryKey: [KEY, 'search', query, filter],
    queryFn: () => api.searchStays(query, filter),
    enabled,
    staleTime: 15_000,
  });
}

export function useRelaxedSearch(query: SearchQuery, enabled = false) {
  return useQuery({
    queryKey: [KEY, 'relaxed', query],
    queryFn: () => api.searchRelaxed(query),
    enabled,
    staleTime: 30_000,
  });
}

export function useNearbyStays() {
  return useQuery({ queryKey: [KEY, 'nearby'], queryFn: api.getNearbyStays, staleTime: 30_000 });
}

export function useProperty(id: string) {
  return useQuery({ queryKey: [KEY, 'property', id], queryFn: () => api.getProperty(id), enabled: !!id });
}

export function useRoomTypes(propertyId: string) {
  return useQuery({
    queryKey: [KEY, 'rooms', propertyId],
    queryFn: () => api.getRoomTypes(propertyId),
    enabled: !!propertyId,
  });
}

export function useReviews(propertyId: string) {
  return useQuery({
    queryKey: [KEY, 'reviews', propertyId],
    queryFn: () => api.getReviews(propertyId),
    enabled: !!propertyId,
  });
}

export function useAddOns() {
  return useQuery({ queryKey: [KEY, 'addons'], queryFn: api.getAddOns, staleTime: 120_000 });
}

export function useGuestProfile() {
  return useQuery({ queryKey: [KEY, 'profile'], queryFn: api.getGuestProfile, staleTime: 120_000 });
}

export function useSaved() {
  return useQuery({ queryKey: [KEY, 'saved'], queryFn: api.getSaved, staleTime: 15_000 });
}

export function useToggleSaved() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.toggleSaved(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'saved'] });
      qc.invalidateQueries({ queryKey: [KEY, 'home'] });
    },
  });
}

export function usePreviewBreakdown(input: PrebookInput, enabled = true) {
  return useQuery({
    queryKey: [KEY, 'quote', input],
    queryFn: () => api.previewBreakdown(input),
    enabled,
    staleTime: 10_000,
  });
}

export function usePrebook() {
  return useMutation({ mutationFn: (input: PrebookInput) => api.prebook(input) });
}

export function useBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: BookInput) => api.book(args),
    onSuccess: (res) => {
      if (res.ok) qc.invalidateQueries({ queryKey: [KEY, 'reservations'] });
    },
  });
}

export function useReservation(id: string) {
  return useQuery({
    queryKey: [KEY, 'reservations', id],
    queryFn: () => api.getReservation(id),
    enabled: !!id,
  });
}
