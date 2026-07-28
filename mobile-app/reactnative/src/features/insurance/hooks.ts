// ── Insurance — Data hooks (React Query v5) ──────────────────────────────────
// Screens stay declarative and share caching/loading/error contracts.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  bindPolicy,
  cancelPolicy,
  createQuote,
  getCertificateUrl,
  getCoverSummary,
  getKycProfile,
  getPolicies,
  getPolicy,
  getProduct,
  getProducts,
  getQuote,
  getRefundStatus,
  recordConsent,
  renewPolicy,
  saveBeneficiaries,
} from './api';
import type {
  Beneficiary,
  ConsentPayload,
  ProductLine,
  QuoteInput,
} from './types';

const KEY = 'insurance';

// ── Catalog ──────────────────────────────────────────────────────────────────
export function useProducts(line?: ProductLine) {
  return useQuery({
    queryKey: [KEY, 'products', line ?? 'all'],
    queryFn: () => getProducts(line),
    staleTime: 5 * 60_000,
  });
}

export function useProduct(code: string) {
  return useQuery({
    queryKey: [KEY, 'product', code],
    queryFn: () => getProduct(code),
    enabled: !!code,
    staleTime: 5 * 60_000,
  });
}

export function useKycProfile() {
  return useQuery({
    queryKey: [KEY, 'kyc'],
    queryFn: getKycProfile,
    staleTime: 5 * 60_000,
  });
}

export function useCoverSummary() {
  return useQuery({
    queryKey: [KEY, 'cover-summary'],
    queryFn: getCoverSummary,
    staleTime: 30_000,
  });
}

// ── Quote ─────────────────────────────────────────────────────────────────────
export function useCreateQuote() {
  return useMutation({
    mutationFn: (input: QuoteInput) => createQuote(input),
  });
}

export function useQuote(id: string) {
  return useQuery({
    queryKey: [KEY, 'quote', id],
    queryFn: () => getQuote(id),
    enabled: !!id,
    staleTime: 60_000,
  });
}

// ── Consent ─────────────────────────────────────────────────────────────────
export function useRecordConsent() {
  return useMutation({
    mutationFn: (payload: ConsentPayload) => recordConsent(payload),
  });
}

// ── Bind ─────────────────────────────────────────────────────────────────────
export function useBindPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { quoteId: string; idempotencyKey: string }) => bindPolicy(args),
    onSuccess: (res) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: [KEY, 'policies'] });
        qc.invalidateQueries({ queryKey: [KEY, 'cover-summary'] });
      }
    },
  });
}

// ── Policy wallet ─────────────────────────────────────────────────────────────
export function usePolicies() {
  return useQuery({
    queryKey: [KEY, 'policies'],
    queryFn: getPolicies,
    staleTime: 30_000,
  });
}

export function usePolicy(id: string) {
  return useQuery({
    queryKey: [KEY, 'policy', id],
    queryFn: () => getPolicy(id),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useCertificate(id: string) {
  return useQuery({
    queryKey: [KEY, 'certificate', id],
    queryFn: () => getCertificateUrl(id),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });
}

export function useSaveBeneficiaries(policyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (beneficiaries: Beneficiary[]) => saveBeneficiaries(policyId, beneficiaries),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'policy', policyId] });
      qc.invalidateQueries({ queryKey: [KEY, 'policies'] });
    },
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
export function useRenewPolicy(policyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (idempotencyKey: string) => renewPolicy({ policyId, idempotencyKey }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'policy', policyId] });
      qc.invalidateQueries({ queryKey: [KEY, 'policies'] });
      qc.invalidateQueries({ queryKey: [KEY, 'cover-summary'] });
    },
  });
}

export function useCancelPolicy(policyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => cancelPolicy({ policyId, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'policy', policyId] });
      qc.invalidateQueries({ queryKey: [KEY, 'policies'] });
      qc.invalidateQueries({ queryKey: [KEY, 'cover-summary'] });
    },
  });
}

export function useRefundStatus(policyId: string) {
  return useQuery({
    queryKey: [KEY, 'refund', policyId],
    queryFn: () => getRefundStatus(policyId),
    enabled: !!policyId,
    staleTime: 15_000,
  });
}
