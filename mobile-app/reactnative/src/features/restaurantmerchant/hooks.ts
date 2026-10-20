// React Query hooks over the merchant api. Mutations invalidate the store detail
// so the screen re-renders with server truth after each change.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as merchant from './api';
import { uploadKYBDocument, type KYBPickedFile } from './kybUpload';
import { uploadStoreImage, type PickedStoreImage } from './storeImageUpload';
import type { StaffMember } from './types';
import type { CreateStoreInput, UpdateStoreInput, StoreHourWindow } from './types';

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

/** Why the pictures didn't attach, in words the owner can act on. Both upload errors the
 *  picker raises already carry owner-facing text. */
function uploadFailureText(e: unknown): string {
  return e instanceof Error ? e.message : 'The picture could not be uploaded.';
}

/**
 * Create an outlet, then attach the logo and banner chosen for it.
 *
 * The presign needs a store id, so the pictures picked during set-up can only be sent
 * once the outlet exists. A failed upload therefore does NOT undo the outlet — the
 * screen is told about it separately, because "your outlet is created, but the banner
 * didn't take" is the truth and the owner can retry from Store details.
 */
export function useCreateStoreWithImages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { store: CreateStoreInput; logo?: PickedStoreImage | null; banner?: PickedStoreImage | null }) => {
      const created = await merchant.createStore(input.store);
      const patch: UpdateStoreInput = {};
      try {
        if (input.logo) patch.logoUrl = await uploadStoreImage(created.id, 'logo', input.logo);
        if (input.banner) patch.bannerUrl = await uploadStoreImage(created.id, 'banner', input.banner);
        if (patch.logoUrl || patch.bannerUrl) await merchant.updateStore(created.id, patch);
        qc.invalidateQueries({ queryKey: [KEY] });
        return { store: created, imageError: null as string | null };
      } catch (e) {
        qc.invalidateQueries({ queryKey: [KEY] });
        return { store: created, imageError: uploadFailureText(e) };
      }
    },
  });
}

/** Send a picked dish photo to storage for this outlet; returns the key to save on the item. */
export function useUploadItemImage(storeId: string) {
  return useMutation({
    mutationFn: (file: PickedStoreImage) => uploadStoreImage(storeId, 'menu', file),
  });
}

/** The outlet's weekly trading hours, with the server's own open-now verdict. */
export function useBusinessHours(id?: string) {
  return useQuery({
    queryKey: [KEY, 'hours', id],
    queryFn: () => merchant.getBusinessHours(id as string),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

/**
 * Replace the whole week. The PUT is a full replace, so the windows sent are the entire
 * schedule the editor shows; the detail query is invalidated too because the store card
 * reads open-now style facts from the same screen.
 */
export function useSetBusinessHours(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (windows: StoreHourWindow[]) => merchant.setBusinessHours(id, windows),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'hours', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'detail', id] });
    },
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

export function useUserLookup(query: string) {
  return useQuery({
    queryKey: [KEY, 'lookup', query],
    queryFn: () => merchant.lookupUser(query),
    enabled: Boolean(query?.trim()),
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

export function useKYB(id: string) {
  return useQuery({
    queryKey: [KEY, 'kyb', id],
    queryFn: () => merchant.getKYB(id),
    enabled: Boolean(id),
  });
}

export function useSaveKYB(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: merchant.SaveKYBInput) => merchant.saveKYB(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'kyb', id] }),
  });
}

export function useAddKYBDocument(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { docType: string; fileUrl: string; fileName?: string }) =>
      merchant.addKYBDocument(id, v.docType, v.fileUrl, v.fileName),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'kyb', id] }),
  });
}

/** Pick-and-send a KYB document: presign, PUT to storage, then record the key. */
export function useUploadKYBDocument(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { docType: string; file: KYBPickedFile }) => uploadKYBDocument(id, v.docType, v.file),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'kyb', id] }),
  });
}

export function useSubmitKYB(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => merchant.submitKYB(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'kyb', id] });
      // The payout-readiness banner and the availability notice both read kybStatus.
      qc.invalidateQueries({ queryKey: [KEY, 'payout-readiness'] });
    },
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
    mutationFn: (input: { categoryId: string; name: string; description?: string; priceKobo: number; imageUrl?: string }) =>
      merchant.createItem(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'detail', id] }),
  });
}

export function useUpdateItem(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { itemId: string; patch: { priceKobo?: number; isAvailable?: boolean; imageUrl?: string } }) =>
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

export function useMenuTaxonomy() {
  return useQuery({
    queryKey: [KEY, 'taxonomy'],
    queryFn: merchant.getMenuTaxonomy,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useCreateTaxonomyItem(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: import('./taxonomy').TaxonomyItemPayload) => merchant.createTaxonomyItem(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'detail', id] }),
  });
}
