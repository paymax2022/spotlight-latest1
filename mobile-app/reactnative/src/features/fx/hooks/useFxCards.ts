// ── FX Exchange — Cards data hooks ───────────────────────────────────────────
// React Query hooks for the cards vertical, mirroring useFx.ts conventions.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as cards from '../api/fxCards.api';
import type { CreateCardDraft, SpendingControls } from '../types/fx.types';
import { newIdempotencyKey } from '../utils/fxFormatters';

const KEY = 'fx-cards';

export function useCards() {
  return useQuery({ queryKey: [KEY, 'list'], queryFn: cards.getCards, staleTime: 20_000 });
}

export function useCard(id?: string) {
  return useQuery({
    queryKey: [KEY, 'card', id],
    queryFn: () => cards.getCard(id as string),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function useCreateCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: CreateCardDraft) => cards.createCard(draft, newIdempotencyKey('card')),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useRevealCard() {
  return useMutation({ mutationFn: (id: string) => cards.revealCard(id) });
}

export function useFundCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) => cards.fundCard(id, amount, newIdempotencyKey('fund')),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY] }); qc.invalidateQueries({ queryKey: ['fx', 'balances'] }); },
  });
}

export function useSetCardFrozen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, frozen }: { id: string; frozen: boolean }) => cards.setCardFrozen(id, frozen),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useTerminateCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cards.terminateCard(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useUpdateCardControls() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, controls }: { id: string; controls: SpendingControls }) => cards.updateCardControls(id, controls),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useCardTransactions(cardId?: string) {
  return useQuery({
    queryKey: [KEY, 'transactions', cardId],
    queryFn: () => cards.getCardTransactions(cardId as string),
    enabled: Boolean(cardId),
    staleTime: 15_000,
  });
}
