// Which organisation the in-app admin console is acting on.
//
// A real per-org officer never needs this: `/me/admin-access` carries their
// organisation and the backend scopes every admin read off their membership. A
// platform super-admin does — that DTO reports `organisationId: null`, so with no
// remembered pick each read arrives unscoped and `resolveOrgID` fails to find a
// membership row (see api/adminScope.ts for the full chain).
//
// Persisted because the console is nine separate screens and a switcher that
// forgot its answer on every navigation would ask on each one. Zustand + AsyncStorage
// mirrors the app's other durable choice (crowdfunding/store/campaignDraftStore.ts).
//
// The value is a hint, never an authority: `resolveAdminOrgScope` drops a stored
// id the current account cannot see, so signing in as someone else on the same
// device cannot strand the console on another tenant's organisation.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AdminOrgState {
  /** The admin's explicit pick, or null when they have not chosen yet. */
  orgId: string | null;
  /** False until the persisted pick has been read back from storage. */
  hasHydrated: boolean;
  select: (orgId: string) => void;
  clear: () => void;
}

export const useAdminOrgStore = create<AdminOrgState>()(
  persist(
    (set) => ({
      orgId: null,
      hasHydrated: false,
      select: (orgId) => set({ orgId }),
      clear: () => set({ orgId: null }),
    }),
    {
      name: 'association-admin-selected-org',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: (s) => ({ orgId: s.orgId }),
      // Flip the flag on both paths: on a storage error `state` is undefined, so
      // setting it through the rehydrated state would no-op and leave the console
      // waiting forever on a flag that never becomes true.
      onRehydrateStorage: () => (_state, error) => {
        if (error) console.warn('[adminOrg] rehydrate failed; treating as no pick yet', error);
        useAdminOrgStore.setState({ hasHydrated: true });
      },
    },
  ),
);
