// ── Crowdfunding — Campaign creation draft store ─────────────────────────────
// Holds the in-progress wizard draft (Section G). Zustand mirrors the app's
// existing store pattern (see src/store/authStore.ts).

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  CampaignDraftInput,
  DraftBudgetItem,
  DraftMilestone,
  DraftRewardTier,
} from '../types/crowdfunding.types';
import { persistableMedia } from './draftPersistence';

const emptyDraft: CampaignDraftInput = {
  type: null,
  category: null,
  title: '',
  summary: '',
  story: '',
  coverImageUri: null,
  galleryUris: [],
  videoUri: null,
  goalKobo: 0,
  currency: 'NGN',
  deadline: null,
  location: '',
  beneficiaryName: '',
  beneficiaryRelationship: '',
  budget: [],
  disbursementModel: null,
  milestones: [],
  rewardTiers: [],
  documentLabels: [],
  refundPolicy:
    'Contributions may be refunded before any funds are disbursed. Once funds are released, contributions are non-refundable except as required by law.',
  acceptedPolicy: false,
};

interface DraftState {
  draft: CampaignDraftInput;
  /** False until the persisted draft has been read back from storage. */
  hasHydrated: boolean;
  patch: (partial: Partial<CampaignDraftInput>) => void;
  addBudgetItem: (item: DraftBudgetItem) => void;
  removeBudgetItem: (id: string) => void;
  addMilestone: (item: DraftMilestone) => void;
  removeMilestone: (id: string) => void;
  addRewardTier: (item: DraftRewardTier) => void;
  removeRewardTier: (id: string) => void;
  reset: () => void;
  budgetTotalKobo: () => number;
}

export const useCampaignDraft = create<DraftState>()(
  persist(
    (set, get) => ({
      draft: { ...emptyDraft },
      hasHydrated: false,

      patch: (partial) => set((s) => ({ draft: { ...s.draft, ...partial } })),

      addBudgetItem: (item) => set((s) => ({ draft: { ...s.draft, budget: [...s.draft.budget, item] } })),
      removeBudgetItem: (id) => set((s) => ({ draft: { ...s.draft, budget: s.draft.budget.filter((b) => b.id !== id) } })),

      addMilestone: (item) => set((s) => ({ draft: { ...s.draft, milestones: [...s.draft.milestones, item] } })),
      removeMilestone: (id) => set((s) => ({ draft: { ...s.draft, milestones: s.draft.milestones.filter((m) => m.id !== id) } })),

      addRewardTier: (item) => set((s) => ({ draft: { ...s.draft, rewardTiers: [...s.draft.rewardTiers, item] } })),
      removeRewardTier: (id) => set((s) => ({ draft: { ...s.draft, rewardTiers: s.draft.rewardTiers.filter((r) => r.id !== id) } })),

      reset: () => set({ draft: { ...emptyDraft, budget: [], milestones: [], rewardTiers: [], galleryUris: [], documentLabels: [] } }),

      budgetTotalKobo: () => get().draft.budget.reduce((sum, b) => sum + b.amountKobo, 0),
    }),
    {
      name: 'crowdfunding-campaign-draft',
      // AsyncStorage resolves to localStorage on react-native-web, which is the
      // case this exists for: the wizard guards each step, but a browser reload
      // used to wipe the in-memory draft while the preview screen kept
      // rendering, so type/category went back to null and the submit POST was
      // rejected with a bare 400.
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: (s) => ({ draft: persistableMedia(s.draft) }),
      // Merge over the current defaults rather than replacing state, so a draft
      // stored by an older build that lacks a newer field still hydrates.
      merge: (persisted, current) => ({
        ...current,
        draft: { ...emptyDraft, ...((persisted as { draft?: Partial<CampaignDraftInput> })?.draft ?? {}) },
      }),
      // Flip the flag on BOTH paths. On a storage error the rehydrated `state`
      // is undefined, so setting the flag through it would silently no-op and
      // leave the wizard gated behind a flag that never becomes true.
      onRehydrateStorage: () => (_state, error) => {
        if (error) console.warn('[campaignDraft] rehydrate failed; starting empty', error);
        useCampaignDraft.setState({ hasHydrated: true });
      },
    },
  ),
);
