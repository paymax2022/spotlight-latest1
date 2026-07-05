// ── Fractional Real Estate — Subscription wizard draft store ─────────────────
// Holds the in-progress invest flow (choose amount → limit-check → sign → PIN →
// processing → certificate) so router params stay simple. Zustand mirrors the
// app's existing store pattern (see crowdfunding/store/campaignDraftStore.ts).

import { create } from 'zustand';
import { makeIdempotencyKey } from '../utils';
import type { LimitCheckResult } from '../types';

export interface InvestDraft {
  offeringId:     string | null;
  /** User chose to enter units or amount. */
  mode:           'units' | 'amount';
  units:          number;
  amountKobo:     number;
  unitPriceKobo:  number;
  /** Result of the inline limit-check (server-authoritative). */
  limitCheck:     LimitCheckResult | null;
  /** Per-offer risk acknowledgement id (set after sign step). */
  offerRiskAckId: string | null;
  /** Stable idempotency key for the whole subscription attempt. */
  idempotencyKey: string | null;
  /** Result investment id after a confirmed subscription. */
  investmentId:   string | null;
}

const empty = (): InvestDraft => ({
  offeringId: null,
  mode: 'amount',
  units: 0,
  amountKobo: 0,
  unitPriceKobo: 0,
  limitCheck: null,
  offerRiskAckId: null,
  idempotencyKey: null,
  investmentId: null,
});

interface DraftState {
  draft: InvestDraft;
  /** Begin a fresh subscription for an offering (resets and seeds an idem key). */
  begin: (offeringId: string, unitPriceKobo: number) => void;
  patch: (partial: Partial<InvestDraft>) => void;
  reset: () => void;
}

export const useInvestDraft = create<DraftState>((set) => ({
  draft: empty(),
  begin: (offeringId, unitPriceKobo) =>
    set({ draft: { ...empty(), offeringId, unitPriceKobo, idempotencyKey: makeIdempotencyKey('fre-sub') } }),
  patch: (partial) => set((s) => ({ draft: { ...s.draft, ...partial } })),
  reset: () => set({ draft: empty() }),
}));
