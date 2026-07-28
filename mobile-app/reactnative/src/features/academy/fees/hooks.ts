// ── Spotlight Academy — EdTech School-Fees module · React Query hooks (v5) ───
// Declarative data hooks the PA-/SA- screens reuse. Mirrors the sibling academy
// hooks module. Money mutations invalidate the affected reads so the derived
// invoice balance (SF-2) always reflects the latest settled payment events.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Api from './api';
import type {
  LinkChildInput,
  CreateVaultInput,
  HardshipInput,
} from './api';
import type { PayMethod, LeaderboardScope, AutoSaveRule } from './types';

const KEY = 'academy-fees';

// ═══════════════════════════════════════════════════════════════════════════════
// PARENT
// ═══════════════════════════════════════════════════════════════════════════════
export function useFeesChildren() {
  return useQuery({ queryKey: [KEY, 'children'], queryFn: Api.getChildren, staleTime: 30_000 });
}

export function useInvoices(childId?: string) {
  return useQuery({ queryKey: [KEY, 'invoices', childId ?? 'all'], queryFn: () => Api.getInvoices(childId), staleTime: 30_000 });
}

export function useInvoice(id?: string) {
  return useQuery({ queryKey: [KEY, 'invoice', id], queryFn: () => Api.getInvoice(id as string), enabled: !!id, staleTime: 30_000 });
}

export function useInstallmentPlan(invoiceId?: string) {
  return useQuery({ queryKey: [KEY, 'installment-plan', invoiceId], queryFn: () => Api.getInstallmentPlan(invoiceId as string), enabled: !!invoiceId, staleTime: 30_000 });
}

export function useLinkChild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LinkChildInput) => Api.linkChild(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'children'] }),
  });
}

export function usePayInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { invoiceId: string; amountKobo: number; method: PayMethod }) =>
      Api.payInvoice(args.invoiceId, args.amountKobo, args.method),
    onSuccess: (_d, args) => {
      qc.invalidateQueries({ queryKey: [KEY, 'invoice', args.invoiceId] });
      qc.invalidateQueries({ queryKey: [KEY, 'invoices'] });
      qc.invalidateQueries({ queryKey: [KEY, 'children'] });
      qc.invalidateQueries({ queryKey: [KEY, 'receipts'] });
    },
  });
}

export function useCreateInstallmentPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { invoiceId: string; count: number }) => Api.createInstallmentPlan(args.invoiceId, args.count),
    onSuccess: (_d, args) => {
      qc.invalidateQueries({ queryKey: [KEY, 'installment-plan', args.invoiceId] });
      qc.invalidateQueries({ queryKey: [KEY, 'invoice', args.invoiceId] });
    },
  });
}

export function useAcceptDisclosure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) => Api.acceptInstallmentDisclosure(invoiceId),
    onSuccess: (_d, invoiceId) => qc.invalidateQueries({ queryKey: [KEY, 'installment-plan', invoiceId] }),
  });
}

export function usePayInstallment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { invoiceId: string; installmentId: string; method: PayMethod }) =>
      Api.payInstallment(args.invoiceId, args.installmentId, args.method),
    onSuccess: (_d, args) => {
      qc.invalidateQueries({ queryKey: [KEY, 'installment-plan', args.invoiceId] });
      qc.invalidateQueries({ queryKey: [KEY, 'invoice', args.invoiceId] });
      qc.invalidateQueries({ queryKey: [KEY, 'invoices'] });
      qc.invalidateQueries({ queryKey: [KEY, 'children'] });
      qc.invalidateQueries({ queryKey: [KEY, 'receipts'] });
    },
  });
}

export function useReceipts() {
  return useQuery({ queryKey: [KEY, 'receipts'], queryFn: Api.getReceipts, staleTime: 15_000 });
}

// ── Fees Vault + auto-save ────────────────────────────────────────────────────
export function useVaults() {
  return useQuery({ queryKey: [KEY, 'vaults'], queryFn: Api.getVaults, staleTime: 30_000 });
}

export function useCreateVault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateVaultInput) => Api.createVault(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'vaults'] }),
  });
}

export function useFundVault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { vaultId: string; amountKobo: number }) => Api.fundVault(args.vaultId, args.amountKobo),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'vaults'] }),
  });
}

export function useUpdateAutoSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { vaultId: string; rule: Omit<AutoSaveRule, 'vaultId' | 'nextRunAt'> }) =>
      Api.updateAutoSave(args.vaultId, args.rule),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'vaults'] }),
  });
}

// ── Hardship ──────────────────────────────────────────────────────────────────
export function useHardshipRequests() {
  return useQuery({ queryKey: [KEY, 'hardship'], queryFn: Api.getHardshipRequests, staleTime: 30_000 });
}

export function useSubmitHardship() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: HardshipInput) => Api.submitHardship(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'hardship'] }),
  });
}

// ── Sponsor-a-student ─────────────────────────────────────────────────────────
export function useSponsorships() {
  return useQuery({ queryKey: [KEY, 'sponsorships'], queryFn: Api.getSponsorships, staleTime: 60_000 });
}

export function usePledgeSponsorship() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { opportunityId: string; amountKobo: number }) => Api.pledgeSponsorship(args.opportunityId, args.amountKobo),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'sponsorships'] }),
  });
}

// ── School directory ──────────────────────────────────────────────────────────
export function useDirectory(query?: string) {
  return useQuery({ queryKey: [KEY, 'directory', query ?? 'all'], queryFn: () => Api.getDirectory(query), staleTime: 60_000 });
}

// ═══════════════════════════════════════════════════════════════════════════════
// STUDENT — competition
// ═══════════════════════════════════════════════════════════════════════════════
export function useCompetitionProfile() {
  return useQuery({ queryKey: [KEY, 'comp', 'me'], queryFn: Api.getCompetitionProfile, staleTime: 30_000 });
}

export function useLeaderboard(scope: LeaderboardScope = 'national') {
  return useQuery({ queryKey: [KEY, 'comp', 'leaderboard', scope], queryFn: () => Api.getLeaderboard(scope), staleTime: 30_000 });
}

export function useTournaments() {
  return useQuery({ queryKey: [KEY, 'comp', 'tournaments'], queryFn: Api.getTournaments, staleTime: 30_000 });
}

export function useJoinTournament() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => Api.joinTournament(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'comp', 'tournaments'] });
      qc.invalidateQueries({ queryKey: [KEY, 'comp', 'me'] });
    },
  });
}

export function useCompetitionChallenges() {
  return useQuery({ queryKey: [KEY, 'comp', 'challenges'], queryFn: Api.getChallenges, staleTime: 30_000 });
}

export function usePlayChallenge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => Api.playChallenge(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'comp', 'challenges'] });
      qc.invalidateQueries({ queryKey: [KEY, 'comp', 'me'] });
      qc.invalidateQueries({ queryKey: [KEY, 'comp', 'leaderboard'] });
    },
  });
}

export function useCompetitionBadges() {
  return useQuery({ queryKey: [KEY, 'comp', 'badges'], queryFn: Api.getBadges, staleTime: 60_000 });
}

export function useCompetitionRewards() {
  return useQuery({ queryKey: [KEY, 'comp', 'rewards'], queryFn: Api.getCompetitionRewards, staleTime: 60_000 });
}

export function useRedeemCompetitionReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => Api.redeemCompetitionReward(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'comp', 'rewards'] });
      qc.invalidateQueries({ queryKey: [KEY, 'comp', 'me'] });
    },
  });
}

export function useSetCompetitionConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (consentGiven: boolean) => Api.setCompetitionConsent(consentGiven),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'comp', 'me'] });
      qc.invalidateQueries({ queryKey: [KEY, 'comp', 'leaderboard'] });
    },
  });
}
