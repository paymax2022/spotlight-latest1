// ── Restaurant merchant — data hooks ─────────────────────────────────────────
// React Query hooks over the merchant api. Mutations invalidate the store detail
// so the screen re-renders with server truth after each change.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as merchant from './api';
import type { CreateStoreInput, UpdateStoreInput, AddBankAccountInput, RequestWithdrawalInput } from './types';

const KEY = 'restaurant-merchant';

export function useMyStores() {
  return useQuery({ queryKey: [KEY, 'mine'], queryFn: merchant.getMyStores, staleTime: 15_000 });
}

export function useEarnings() {
  return useQuery({ queryKey: [KEY, 'earnings'], queryFn: merchant.getEarnings, staleTime: 30_000 });
}

export function useBankAccounts() {
  return useQuery({ queryKey: [KEY, 'banks'], queryFn: merchant.getBankAccounts, staleTime: 30_000 });
}

export function useAddBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddBankAccountInput) => merchant.addBankAccount(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'banks'] }),
  });
}

export function useSetDefaultBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => merchant.setDefaultBankAccount(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'banks'] }),
  });
}

export function useDeleteBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => merchant.deleteBankAccount(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'banks'] }),
  });
}

// ── Withdrawals (money path) ──────────────────────────────────────────────────
export function useWithdrawals() {
  return useQuery({ queryKey: [KEY, 'withdrawals'], queryFn: merchant.getWithdrawals, staleTime: 15_000 });
}

export function useRequestWithdrawal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RequestWithdrawalInput) => merchant.requestWithdrawal(input),
    onSuccess: () => {
      // A withdrawal debits the wallet — refresh history AND the earnings/wallet view.
      qc.invalidateQueries({ queryKey: [KEY, 'withdrawals'] });
      qc.invalidateQueries({ queryKey: [KEY, 'earnings'] });
    },
  });
}

export function useStoreDetail(id?: string) {
  return useQuery({
    queryKey: [KEY, 'detail', id],
    queryFn: () => merchant.getStoreDetail(id as string),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useCreateStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStoreInput) => merchant.createStore(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useUpdateStore(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateStoreInput) => merchant.updateStore(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useSetAvailability(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (isOpen: boolean) => merchant.setAvailability(id, isOpen),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useCreateCategory(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => merchant.createCategory(id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'detail', id] }),
  });
}

export function useDeleteCategory(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) => merchant.deleteCategory(id, categoryId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'detail', id] }),
  });
}

export function useCreateItem(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { categoryId: string; name: string; description?: string; priceKobo: number }) =>
      merchant.createItem(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'detail', id] }),
  });
}

export function useUpdateItem(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { itemId: string; patch: { priceKobo?: number; isAvailable?: boolean } }) =>
      merchant.updateItem(id, args.itemId, args.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'detail', id] }),
  });
}

export function useDeleteItem(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => merchant.deleteItem(id, itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'detail', id] }),
  });
}
