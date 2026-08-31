// ── Insurance (live) — React Query hooks ────────────────────────────────────
// Screens stay declarative; caching, retry and invalidation live here.
//
// Retry policy: a 4xx is the server telling us the request was wrong, so
// retrying it just delays the error state the user needs to see. Only transient
// failures (no response, 5xx) are retried.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addClaimEvidence,
  cancelPolicy,
  createQuote,
  fetchCertificateUrl,
  fetchClaim,
  fetchClaims,
  fetchFormSchema,
  fetchPolicies,
  fetchPolicy,
  fetchProduct,
  fetchProducts,
  fileClaim,
  purchasePolicy,
} from './api';
import type { InsuranceError, ProductLine } from './types';

const KEY = 'insurance-live';

function retryTransientOnly(failureCount: number, error: unknown): boolean {
  const status = (error as InsuranceError)?.status;
  if (status != null && status >= 400 && status < 500) return false;
  return failureCount < 2;
}

const commonQuery = { retry: retryTransientOnly } as const;

// ── Catalog ─────────────────────────────────────────────────────────────────
export function useLiveProducts(line?: ProductLine | null) {
  return useQuery({
    queryKey: [KEY, 'products', line ?? 'all'],
    queryFn: () => fetchProducts(line),
    staleTime: 5 * 60_000,
    ...commonQuery,
  });
}

export function useLiveProduct(code: string) {
  return useQuery({
    queryKey: [KEY, 'product', code],
    queryFn: () => fetchProduct(code),
    enabled: !!code,
    staleTime: 5 * 60_000,
    ...commonQuery,
  });
}

/**
 * The product's bespoke purchase schema. `seedSchema` lets the buy screen start
 * from the copy embedded in `GET /products/:code` instead of blocking on a
 * second round trip, while still refreshing from the dedicated endpoint.
 */
export function useProductSchema(code: string, enabled = true) {
  return useQuery({
    queryKey: [KEY, 'schema', code],
    queryFn: () => fetchFormSchema(code),
    enabled: enabled && !!code,
    staleTime: 30 * 60_000,
    ...commonQuery,
  });
}

// ── Quote / purchase ────────────────────────────────────────────────────────
export function useCreateLiveQuote() {
  return useMutation({
    mutationFn: (args: { productCode: string; inputs: Record<string, unknown> }) =>
      createQuote(args),
    retry: false,
  });
}

export function usePurchasePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: purchasePolicy,
    // A purchase is a money mutation: never retried automatically. The caller
    // reuses the SAME idempotency key if the user retries by hand.
    retry: false,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'policies'] });
    },
  });
}

// ── Policies ────────────────────────────────────────────────────────────────
export function useLivePolicies() {
  return useQuery({
    queryKey: [KEY, 'policies'],
    queryFn: fetchPolicies,
    staleTime: 30_000,
    ...commonQuery,
  });
}

export function useLivePolicy(id: string) {
  return useQuery({
    queryKey: [KEY, 'policy', id],
    queryFn: () => fetchPolicy(id),
    enabled: !!id,
    staleTime: 30_000,
    ...commonQuery,
  });
}

export function useCertificateUrl(id: string, enabled = true) {
  return useQuery({
    queryKey: [KEY, 'certificate', id],
    queryFn: () => fetchCertificateUrl(id),
    enabled: enabled && !!id,
    staleTime: 60_000,
    ...commonQuery,
  });
}

export function useCancelPolicy(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => cancelPolicy({ id, reason }),
    retry: false,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'policy', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'policies'] });
    },
  });
}

// ── Claims ──────────────────────────────────────────────────────────────────
export function useLiveClaims() {
  return useQuery({
    queryKey: [KEY, 'claims'],
    queryFn: fetchClaims,
    staleTime: 30_000,
    ...commonQuery,
  });
}

export function useLiveClaim(id: string) {
  return useQuery({
    queryKey: [KEY, 'claim', id],
    queryFn: () => fetchClaim(id),
    enabled: !!id,
    staleTime: 15_000,
    ...commonQuery,
  });
}

export function useFileClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fileClaim,
    retry: false,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'claims'] });
    },
  });
}

export function useAddClaimEvidence(claimId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (files: { name: string; uri: string; mimeType?: string }[]) =>
      addClaimEvidence({ claimId, files }),
    retry: false,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'claim', claimId] });
      qc.invalidateQueries({ queryKey: [KEY, 'claims'] });
    },
  });
}

// ── Derived ─────────────────────────────────────────────────────────────────
export interface CoverSummary {
  activePolicies: number;
  totalSumInsuredKobo: number;
  totalPremiumKobo: number;
  expiringSoon: number;
}

/**
 * Hub summary, derived from the real `GET /policies` list rather than a second
 * endpoint. Integer kobo throughout.
 */
export function useCoverSummary() {
  const policies = useLivePolicies();
  const rows = policies.data ?? [];
  const active = rows.filter((p) => p.status === 'active');
  const soon = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const summary: CoverSummary = {
    activePolicies: active.length,
    totalSumInsuredKobo: active.reduce((s, p) => s + p.sumInsuredKobo, 0),
    totalPremiumKobo: active.reduce((s, p) => s + p.premiumKobo, 0),
    expiringSoon: active.filter((p) => {
      if (!p.endsAt) return false;
      const t = Date.parse(p.endsAt);
      return Number.isFinite(t) && t <= soon;
    }).length,
  };
  return { ...policies, summary };
}
