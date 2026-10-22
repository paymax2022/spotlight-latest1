// ── Association — Organisation creation draft store (U) ───────────────────────
// Zustand draft store mirroring the crowdfunding campaign-draft pattern
// (src/features/crowdfunding/store/campaignDraftStore.ts) — including the
// persist middleware that pattern exists for: without it, a browser reload
// (or landing on any /association/create/* route directly) wiped the
// in-memory draft while the wizard's own step indicator kept showing
// progress, so Basics/Branding fields silently reverted to blank and
// Publish was rejected server-side with a bare 400 the UI never surfaced.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OrgDraft, DraftChapter, DraftCategory, DraftCommittee, DraftStateLeader } from '../types/orgDraft.types';

const emptyDraft: OrgDraft = {
  name: '',
  acronym: '',
  category: '',
  description: '',
  location: '',
  website: '',
  foundedYear: '',
  logoUri: null,
  logoPreviewUri: null,
  groupType: null,
  approvalRule: null,
  registrationFeeKobo: 0,
  structureType: 'SINGLE',
  stateLeaders: [],
  chapters: [],
  committees: [],
  categories: [],
  rules: [],
  restrictions: {
    graceDays: 30,
    disableVoting: true,
    disableEvents: true,
    disableChat: false,
    disableCard: false,
  },
  acceptedTerms: false,
};

interface OrgDraftState {
  draft: OrgDraft;
  /** False until the persisted draft has been read back from storage. */
  hasHydrated: boolean;
  patch: (partial: Partial<OrgDraft>) => void;
  addChapter: (c: DraftChapter) => void;
  removeChapter: (id: string) => void;
  addStateLeader: (l: DraftStateLeader) => void;
  updateStateLeader: (id: string, partial: Partial<DraftStateLeader>) => void;
  removeStateLeader: (id: string) => void;
  addCommittee: (c: DraftCommittee) => void;
  removeCommittee: (id: string) => void;
  addCategory: (c: DraftCategory) => void;
  removeCategory: (id: string) => void;
  reset: () => void;
}

export const useOrgDraft = create<OrgDraftState>()(
  persist(
    (set) => ({
      draft: { ...emptyDraft },
      hasHydrated: false,
      patch: (partial) => set((s) => ({ draft: { ...s.draft, ...partial } })),
      addChapter: (c) => set((s) => ({ draft: { ...s.draft, chapters: [...s.draft.chapters, c] } })),
      removeChapter: (id) => set((s) => ({ draft: { ...s.draft, chapters: s.draft.chapters.filter((x) => x.id !== id) } })),
      addStateLeader: (l) => set((s) => ({ draft: { ...s.draft, stateLeaders: [...s.draft.stateLeaders, l] } })),
      updateStateLeader: (id, partial) => set((s) => ({ draft: { ...s.draft, stateLeaders: s.draft.stateLeaders.map((x) => (x.id === id ? { ...x, ...partial } : x)) } })),
      removeStateLeader: (id) => set((s) => ({ draft: { ...s.draft, stateLeaders: s.draft.stateLeaders.filter((x) => x.id !== id) } })),
      addCommittee: (c) => set((s) => ({ draft: { ...s.draft, committees: [...s.draft.committees, c] } })),
      removeCommittee: (id) => set((s) => ({ draft: { ...s.draft, committees: s.draft.committees.filter((x) => x.id !== id) } })),
      addCategory: (c) => set((s) => ({ draft: { ...s.draft, categories: [...s.draft.categories, c] } })),
      removeCategory: (id) => set((s) => ({ draft: { ...s.draft, categories: s.draft.categories.filter((x) => x.id !== id) } })),
      reset: () => set({ draft: { ...emptyDraft, stateLeaders: [], chapters: [], committees: [], categories: [], rules: [], restrictions: { ...emptyDraft.restrictions } } }),
    }),
    {
      name: 'association-org-draft',
      // AsyncStorage resolves to localStorage on react-native-web — see the
      // header comment for why this exists.
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      // logoPreviewUri is a local file:// URI kept only so the just-picked
      // image renders before its upload completes (see orgDraft.types.ts) —
      // it is never submitted and won't resolve after a reload, so it is not
      // worth persisting.
      partialize: (s) => ({ draft: { ...s.draft, logoPreviewUri: null } }),
      // Merge over the current defaults rather than replacing state, so a
      // draft stored by an older build that lacks a newer field still
      // hydrates instead of crashing on a missing key.
      merge: (persisted, current) => ({
        ...current,
        draft: { ...emptyDraft, ...((persisted as { draft?: Partial<OrgDraft> })?.draft ?? {}) },
      }),
      // Flip the flag on BOTH paths. On a storage error the rehydrated
      // `state` is undefined, so setting the flag through it would silently
      // no-op and leave the wizard gated behind a flag that never becomes true.
      onRehydrateStorage: () => (_state, error) => {
        if (error) console.warn('[orgDraft] rehydrate failed; starting empty', error);
        useOrgDraft.setState({ hasHydrated: true });
      },
    },
  ),
);
