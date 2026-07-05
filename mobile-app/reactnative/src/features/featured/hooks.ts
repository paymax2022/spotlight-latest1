// ── Featured Placement — Data hooks ───────────────────────────────────────────
// React Query hooks mirroring food/hooks.ts so screens stay declarative and
// share caching / loading / error contracts. Money mutations (submit, pay)
// attach Idempotency-Keys generated here, never reused across retries.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as featured from './api';
import { newIdempotencyKey, toFeaturedError } from './utils';
import type { CreateDraftRequest, PlacementEvent } from './types';

const KEY = 'featured';

// ─── Zones & eligible items ──────────────────────────────────────────────────
export function useZones() {
  return useQuery({ queryKey: [KEY, 'zones'], queryFn: featured.listZones, staleTime: 60_000 });
}

export function useEligibleItems() {
  return useQuery({
    queryKey: [KEY, 'eligible'],
    queryFn: featured.listEligibleItems,
    staleTime: 60_000,
  });
}

// ─── Campaigns ───────────────────────────────────────────────────────────────
/** "My Promotions" list. Poll so status/countdown stay fresh. */
export function useMyPromotions(options?: { poll?: boolean }) {
  return useQuery({
    queryKey: [KEY, 'campaigns'],
    queryFn: featured.listCampaigns,
    refetchInterval: options?.poll ? 8_000 : false,
    staleTime: 5_000,
  });
}

export function useCampaign(id?: string, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: [KEY, 'campaign', id],
    queryFn: () => featured.getCampaign(id as string),
    enabled: Boolean(id),
    refetchInterval: options?.poll ? 6_000 : false,
    staleTime: 3_000,
  });
}

export function useCampaignAnalytics(id?: string, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: [KEY, 'analytics', id],
    queryFn: () => featured.getAnalytics(id as string),
    enabled: Boolean(id),
    refetchInterval: options?.poll ? 6_000 : false,
    staleTime: 3_000,
  });
}

export function useCreateDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateDraftRequest) => featured.createDraft(req),
    onError: (e) => {
      throw toFeaturedError(e);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'campaigns'] });
    },
  });
}

export function useQuote() {
  return useMutation({
    mutationFn: (id: string) => featured.quoteCampaign(id),
    onError: (e) => {
      throw toFeaturedError(e);
    },
  });
}

/** Submit for review — Idempotency-Key per attempt. */
export function useSubmit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => featured.submitCampaign(id, newIdempotencyKey('featured-submit')),
    onError: (e) => {
      throw toFeaturedError(e);
    },
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: [KEY, 'campaign', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'campaigns'] });
    },
  });
}

/** Pay — money mutation → Idempotency-Key per attempt. */
export function usePayCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => featured.payCampaign(id, newIdempotencyKey('featured-pay')),
    onError: (e) => {
      throw toFeaturedError(e);
    },
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: [KEY, 'campaign', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'campaigns'] });
    },
  });
}

export function useCancel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => featured.cancelCampaign(id),
    onError: (e) => {
      throw toFeaturedError(e);
    },
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: [KEY, 'campaign', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'campaigns'] });
    },
  });
}

export function usePause() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => featured.pauseCampaign(id),
    onError: (e) => {
      throw toFeaturedError(e);
    },
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: [KEY, 'campaign', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'campaigns'] });
    },
  });
}

export function useResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => featured.resumeCampaign(id),
    onError: (e) => {
      throw toFeaturedError(e);
    },
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: [KEY, 'campaign', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'campaigns'] });
    },
  });
}

// ─── Public landing + events ─────────────────────────────────────────────────
export function useLandingPlacements(options?: { poll?: boolean }) {
  return useQuery({
    queryKey: [KEY, 'landing'],
    queryFn: featured.getLandingPlacements,
    refetchInterval: options?.poll ? 30_000 : false,
    staleTime: 20_000,
  });
}

/** Fire impression/tap events. Failures are swallowed (best-effort telemetry). */
export function useReportEvents() {
  return useMutation({
    mutationFn: (events: PlacementEvent[]) => featured.reportEvents(events),
    onError: () => {
      /* swallow — telemetry must never break the UI */
    },
  });
}
