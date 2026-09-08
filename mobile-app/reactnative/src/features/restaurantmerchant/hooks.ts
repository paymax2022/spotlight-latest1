// ── Restaurant merchant — data hooks ─────────────────────────────────────────
// React Query hooks over the merchant api. Mutations invalidate the store detail
// so the screen re-renders with server truth after each change.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as merchant from './api';
import type { StaffMember } from './types';
import type { CreateStoreInput, UpdateStoreInput } from './types';

const KEY = 'restaurant-merchant';

export function useMyStores() {
  return useQuery({ queryKey: [KEY, 'mine'], queryFn: merchant.getMyStores, staleTime: 15_000 });
}

export function useEarnings() {
  return useQuery({ queryKey: [KEY, 'earnings'], queryFn: merchant.getEarnings, staleTime: 30_000 });
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

/** Per-outlet payout readiness for the signed-in owner. */
export function usePayoutReadiness() {
  return useQuery({ queryKey: [KEY, 'payout-readiness'], queryFn: merchant.getPayoutReadiness, staleTime: 60_000 });
}

export function useStaff(restaurantId: string) {
  return useQuery({
    queryKey: [KEY, 'staff', restaurantId],
    queryFn: () => merchant.listStaff(restaurantId),
    enabled: Boolean(restaurantId),
  });
}

export function useInviteStaff(restaurantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; role: StaffMember['role'] }) =>
      merchant.inviteStaff(restaurantId, v.userId, v.role),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'staff', restaurantId] }),
  });
}

export function useSetStaffStatus(restaurantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; status: StaffMember['status'] }) =>
      merchant.setStaffStatus(restaurantId, v.userId, v.status),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'staff', restaurantId] }),
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
