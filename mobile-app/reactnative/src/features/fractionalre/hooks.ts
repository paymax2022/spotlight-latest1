// ── Fractional Real Estate — React Query hooks ───────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import { calcReturns } from './utils';
import type {
  SuitabilityInput, SubscribeRequest, AutoInvestInput, ListFractionInput,
  BuyListingRequest, CreateGoalInput, ReturnsCalcInput, Beneficiary, BeneficiaryInput,
} from './types';

const KEY = 'fractionalre';

// ── Account / onboarding ─────────────────────────────────────────────────────

export function useInvestorProfile() {
  return useQuery({ queryKey: [KEY, 'me'], queryFn: api.getInvestorProfile, staleTime: 10_000, retry: 1 });
}

export function useActivate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.activate,
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'me'] }),
  });
}

export function useSubmitSuitability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SuitabilityInput) => api.submitSuitability(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'me'] }),
  });
}

export function useAcknowledgeRisk() {
  return useMutation({ mutationFn: (scope: 'master' | string) => api.acknowledgeRisk(scope) });
}

// ── Offerings ────────────────────────────────────────────────────────────────

export function useOfferings(params?: { kind?: string; risk?: string; q?: string }) {
  return useQuery({
    queryKey: [KEY, 'offerings', params ?? {}],
    queryFn: () => api.getOfferings(params),
    staleTime: 30_000,
    retry: 1,
  });
}

export function useOffering(id?: string) {
  return useQuery({
    queryKey: [KEY, 'offering', id],
    queryFn: () => api.getOffering(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
    retry: 1,
  });
}

export function useWatchlist() {
  return useQuery({ queryKey: [KEY, 'watchlist'], queryFn: api.getWatchlist, staleTime: 15_000, retry: 1 });
}

export function useToggleWatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, watched }: { id: string; watched: boolean }) =>
      (watched ? api.unwatchOffering(id) : api.watchOffering(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'watchlist'] });
      qc.invalidateQueries({ queryKey: [KEY, 'offerings'] });
      qc.invalidateQueries({ queryKey: [KEY, 'offering'] });
    },
  });
}

// ── Limit check ──────────────────────────────────────────────────────────────

export function useLimitCheck() {
  return useMutation({
    mutationFn: ({ offeringId, amountKobo }: { offeringId: string; amountKobo: number }) =>
      api.limitCheck(offeringId, amountKobo),
  });
}

// ── Subscription ─────────────────────────────────────────────────────────────

export function useSubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ offeringId, req }: { offeringId: string; req: SubscribeRequest }) =>
      api.subscribe(offeringId, req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'portfolio'] });
      qc.invalidateQueries({ queryKey: [KEY, 'holdings'] });
      qc.invalidateQueries({ queryKey: [KEY, 'me'] });
    },
  });
}

export function useCertificate(investmentId?: string) {
  return useQuery({
    queryKey: [KEY, 'certificate', investmentId],
    queryFn: () => api.getCertificate(investmentId as string),
    enabled: Boolean(investmentId),
    retry: 1,
  });
}

// ── Portfolio ────────────────────────────────────────────────────────────────

export function usePortfolio() {
  return useQuery({ queryKey: [KEY, 'portfolio'], queryFn: api.getPortfolio, staleTime: 20_000, retry: 1 });
}
export function useHoldings() {
  return useQuery({ queryKey: [KEY, 'holdings'], queryFn: api.getHoldings, staleTime: 20_000, retry: 1 });
}
export function useHolding(id?: string) {
  return useQuery({
    queryKey: [KEY, 'holding', id],
    queryFn: () => api.getHolding(id as string),
    enabled: Boolean(id),
    staleTime: 20_000,
    retry: 1,
  });
}
export function usePayouts() {
  return useQuery({ queryKey: [KEY, 'payouts'], queryFn: api.getPayouts, staleTime: 20_000, retry: 1 });
}
export function useStatements() {
  return useQuery({ queryKey: [KEY, 'statements'], queryFn: api.getStatements, staleTime: 60_000, retry: 1 });
}

// ── Auto-invest ──────────────────────────────────────────────────────────────

export function useAutoInvest() {
  return useQuery({ queryKey: [KEY, 'auto-invest'], queryFn: api.getAutoInvest, staleTime: 30_000, retry: 1 });
}
export function useCreateAutoInvest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: AutoInvestInput; idempotencyKey: string }) =>
      api.createAutoInvest(input, idempotencyKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'auto-invest'] }),
  });
}
export function usePauseAutoInvest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.pauseAutoInvest(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'auto-invest'] }),
  });
}

// ── Secondary market ─────────────────────────────────────────────────────────

export function useMarket() {
  return useQuery({ queryKey: [KEY, 'market'], queryFn: api.getMarket, staleTime: 15_000, retry: 1 });
}
export function useMarketOrders() {
  return useQuery({ queryKey: [KEY, 'market-orders'], queryFn: api.getMarketOrders, staleTime: 15_000, retry: 1 });
}
export function useListFraction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: ListFractionInput; idempotencyKey: string }) =>
      api.listFraction(input, idempotencyKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'market'] });
      qc.invalidateQueries({ queryKey: [KEY, 'market-orders'] });
    },
  });
}
export function useBuyListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ listingId, req }: { listingId: string; req: BuyListingRequest }) =>
      api.buyListing(listingId, req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'market'] });
      qc.invalidateQueries({ queryKey: [KEY, 'market-orders'] });
      qc.invalidateQueries({ queryKey: [KEY, 'portfolio'] });
    },
  });
}

// ── Documents / goals ────────────────────────────────────────────────────────

export function useDocuments() {
  return useQuery({ queryKey: [KEY, 'documents'], queryFn: api.getDocuments, staleTime: 60_000, retry: 1 });
}
export function useGoals() {
  return useQuery({ queryKey: [KEY, 'goals'], queryFn: api.getGoals, staleTime: 30_000, retry: 1 });
}
export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGoalInput) => api.createGoal(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'goals'] }),
  });
}

// ── Beneficiaries ────────────────────────────────────────────────────────────

export function useBeneficiaries() {
  return useQuery({ queryKey: [KEY, 'beneficiaries'], queryFn: api.getBeneficiaries, staleTime: 15_000, retry: 1 });
}

/** Optimistic add: the row appears immediately and rolls back on failure. */
export function useAddBeneficiary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BeneficiaryInput) => api.addBeneficiary(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: [KEY, 'beneficiaries'] });
      const previous = qc.getQueryData<Beneficiary[]>([KEY, 'beneficiaries']);
      qc.setQueryData<Beneficiary[]>([KEY, 'beneficiaries'], (old) => [
        ...(old ?? []),
        { id: `optimistic-${Date.now()}`, name: input.name, relationship: input.relationship, share_pct: input.share_pct },
      ]);
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      qc.setQueryData([KEY, 'beneficiaries'], ctx?.previous ?? []);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [KEY, 'beneficiaries'] }),
  });
}

export function useRemoveBeneficiary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.removeBeneficiary(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'beneficiaries'] }),
  });
}

// ── Referrals ────────────────────────────────────────────────────────────────

export function useReferrals() {
  return useQuery({ queryKey: [KEY, 'referrals'], queryFn: api.getReferrals, staleTime: 60_000, retry: 1 });
}

// ── Returns calculator (pure client preview) ─────────────────────────────────

export function useRentReturnsCalc(input: ReturnsCalcInput | null) {
  return input ? calcReturns(input) : null;
}
