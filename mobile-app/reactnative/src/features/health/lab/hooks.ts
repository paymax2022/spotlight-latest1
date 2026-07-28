// ── Paymax Health — Laboratory React Query hooks (Phase 2) ───────────────────
// Declarative data hooks the lab screens use. React Query v5.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateIdempotencyKey } from '@/utils/idempotency';
import {
  getTests,
  getTest,
  getPackages,
  getPackage,
  getLabs,
  getLab,
  getPhlebotomist,
  getOrders,
  getOrder,
  createOrder,
  reorder,
  getResult,
  getResults,
  acknowledgeResultConsent,
  shareResult,
  getReviews,
  submitReview,
  getProviderOnboarding,
  submitProviderOnboarding,
  getProviderCatalog,
  getProviderOrders,
  accessionSample,
  enterResult,
  releaseResult,
  getProviderEarnings,
  requestPayout,
  getProviderReviews,
  getAssignments,
  getChecklist,
  logCustody,
  dropOff,
} from './api';
import type {
  CatalogQuery,
  CreateOrderInput,
  SubmitReviewInput,
  ShareResultInput,
  SubmitOnboardingInput,
  AccessionInput,
  ResultEntryInput,
  ResultReleaseInput,
  ChainOfCustodyInput,
  DropOffInput,
} from './types';

const KEY = 'lab';

// ── Catalog ─────────────────────────────────────────────────────────────────
export function useTests(query?: CatalogQuery) {
  return useQuery({
    queryKey: [KEY, 'tests', query ?? {}],
    queryFn: () => getTests(query),
    staleTime: 60_000,
  });
}

export function useTest(id?: string) {
  return useQuery({
    queryKey: [KEY, 'test', id],
    queryFn: () => getTest(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

export function usePackages() {
  return useQuery({
    queryKey: [KEY, 'packages'],
    queryFn: getPackages,
    staleTime: 60_000,
  });
}

export function usePackage(id?: string) {
  return useQuery({
    queryKey: [KEY, 'package', id],
    queryFn: () => getPackage(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ── Labs ────────────────────────────────────────────────────────────────────
export function useLabs(opts?: { homeCollection?: boolean }) {
  return useQuery({
    queryKey: [KEY, 'labs', opts ?? {}],
    queryFn: () => getLabs(opts),
    staleTime: 60_000,
  });
}

export function useLab(id?: string) {
  return useQuery({
    queryKey: [KEY, 'lab', id],
    queryFn: () => getLab(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

export function usePhlebotomist(orderId?: string) {
  return useQuery({
    queryKey: [KEY, 'phlebotomist', orderId],
    queryFn: () => getPhlebotomist(orderId as string),
    enabled: Boolean(orderId),
    // Mimic live tracking: refetch periodically.
    refetchInterval: 15_000,
  });
}

// ── Orders ──────────────────────────────────────────────────────────────────
export function useOrders() {
  return useQuery({ queryKey: [KEY, 'orders'], queryFn: getOrders, staleTime: 15_000 });
}

export function useOrder(id?: string) {
  return useQuery({
    queryKey: [KEY, 'order', id],
    queryFn: () => getOrder(id as string),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOrderInput) => createOrder(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'orders'] });
    },
  });
}

export function useReorder() {
  return useMutation({ mutationFn: (orderId: string) => reorder(orderId) });
}

// ── Results (HL-7 / HL-8) ────────────────────────────────────────────────────
export function useResult(id?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [KEY, 'result', id],
    queryFn: () => getResult(id as string),
    enabled: Boolean(id) && (opts?.enabled ?? true),
    staleTime: 30_000,
  });
}

export function useResults() {
  return useQuery({ queryKey: [KEY, 'results'], queryFn: getResults, staleTime: 30_000 });
}

export function useAcknowledgeResultConsent() {
  return useMutation({ mutationFn: (resultId: string) => acknowledgeResultConsent(resultId) });
}

export function useShareResult() {
  return useMutation({ mutationFn: (input: ShareResultInput) => shareResult(input) });
}

// ── Reviews ──────────────────────────────────────────────────────────────────
export function useReviews(labId?: string) {
  return useQuery({
    queryKey: [KEY, 'reviews', labId],
    queryFn: () => getReviews(labId as string),
    enabled: Boolean(labId),
  });
}

export function useSubmitReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitReviewInput) => submitReview(input),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: [KEY, 'reviews', v.labId] }),
  });
}

// ── Provider (lab) ───────────────────────────────────────────────────────────
export function useProviderOnboarding() {
  return useQuery({ queryKey: [KEY, 'provider', 'onboarding'], queryFn: getProviderOnboarding });
}

export function useSubmitProviderOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitOnboardingInput) => submitProviderOnboarding(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'provider', 'onboarding'] }),
  });
}

export function useProviderCatalog() {
  return useQuery({ queryKey: [KEY, 'provider', 'catalog'], queryFn: getProviderCatalog });
}

export function useProviderOrders() {
  return useQuery({ queryKey: [KEY, 'provider', 'orders'], queryFn: getProviderOrders, staleTime: 10_000 });
}

export function useAccessionSample() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AccessionInput) => accessionSample(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'provider', 'orders'] }),
  });
}

export function useEnterResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ResultEntryInput) => enterResult(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'provider', 'orders'] }),
  });
}

export function useReleaseResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ResultReleaseInput) => releaseResult(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'provider', 'orders'] }),
  });
}

export function useProviderEarnings() {
  return useQuery({ queryKey: [KEY, 'provider', 'earnings'], queryFn: getProviderEarnings });
}

export function useRequestPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountKobo: number) => requestPayout(amountKobo, generateIdempotencyKey()),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'provider', 'earnings'] }),
  });
}

export function useProviderReviews() {
  return useQuery({ queryKey: [KEY, 'provider', 'reviews'], queryFn: getProviderReviews });
}

// ── Phlebotomist ─────────────────────────────────────────────────────────────
export function useAssignments() {
  return useQuery({ queryKey: [KEY, 'phleb', 'assignments'], queryFn: getAssignments, staleTime: 10_000 });
}

export function useChecklist(orderId?: string) {
  return useQuery({
    queryKey: [KEY, 'phleb', 'checklist', orderId],
    queryFn: () => getChecklist(orderId as string),
    enabled: Boolean(orderId),
  });
}

export function useLogCustody() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ChainOfCustodyInput) => logCustody(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'phleb', 'assignments'] }),
  });
}

export function useDropOff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DropOffInput) => dropOff(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'phleb', 'assignments'] }),
  });
}
