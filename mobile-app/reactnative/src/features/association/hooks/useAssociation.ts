// ── Association — Data hooks ──────────────────────────────────────────────────
// React Query hooks (mirrors the voting / crowdfunding hook pattern) so screens
// stay declarative and share caching / loading / error contracts.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getOrganisations,
  getOrganisation,
  submitApplication,
  getDashboard,
  getMembershipCard,
  getDirectory,
  getMember,
  getDues,
  getReceipt,
  payInvoice,
  getElections,
  getElection,
  castVote,
  verifyMembershipCard,
} from '../api/association.api';
import type { JoinDraft, MemberDirectoryQuery } from '../types/association.types';

const KEY = 'association';

export function useOrganisations(search?: string) {
  return useQuery({
    queryKey: [KEY, 'orgs', search ?? ''],
    queryFn: () => getOrganisations(search),
    staleTime: 60_000,
  });
}

export function useOrganisation(id?: string) {
  return useQuery({
    queryKey: [KEY, 'org', id],
    queryFn: () => getOrganisation(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

export function useSubmitApplication() {
  return useMutation({
    mutationFn: (draft: JoinDraft) => submitApplication(draft),
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: [KEY, 'dashboard'],
    queryFn: getDashboard,
    staleTime: 30_000,
  });
}

export function useMembershipCard() {
  return useQuery({
    queryKey: [KEY, 'card'],
    queryFn: getMembershipCard,
    staleTime: 60_000,
  });
}

/** Verify a scanned membership-card QR token (POST /cards/verify). */
export function useVerifyCard() {
  return useMutation({ mutationFn: (token: string) => verifyMembershipCard(token) });
}

export function useDirectory(query?: MemberDirectoryQuery) {
  return useQuery({
    queryKey: [KEY, 'directory', query ?? {}],
    queryFn: () => getDirectory(query),
    staleTime: 30_000,
  });
}

export function useMember(id?: string) {
  return useQuery({
    queryKey: [KEY, 'member', id],
    queryFn: () => getMember(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useDues() {
  return useQuery({
    queryKey: [KEY, 'dues'],
    queryFn: getDues,
    staleTime: 15_000,
  });
}

export function useReceipt(receiptId?: string) {
  return useQuery({
    queryKey: [KEY, 'receipt', receiptId],
    queryFn: () => getReceipt(receiptId as string),
    enabled: Boolean(receiptId),
    staleTime: 5 * 60_000,
  });
}

export function usePayInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, method }: { invoiceId: string; method: 'WALLET' | 'PAYSTACK' }) =>
      payInvoice(invoiceId, method),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'dues'] });
      qc.invalidateQueries({ queryKey: [KEY, 'dashboard'] });
    },
  });
}

// ─── Elections (TS-13) ────────────────────────────────────────────────────────

export function useElections() {
  return useQuery({ queryKey: [KEY, 'elections'], queryFn: getElections, staleTime: 30_000 });
}

export function useElection(id?: string) {
  return useQuery({
    queryKey: [KEY, 'election', id],
    queryFn: () => getElection(id as string),
    enabled: !!id,
    staleTime: 15_000,
  });
}

export function useCastVote(electionId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { positionId: string; candidateId: string }) =>
      castVote(electionId as string, v.positionId, v.candidateId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'election', electionId] });
    },
  });
}
