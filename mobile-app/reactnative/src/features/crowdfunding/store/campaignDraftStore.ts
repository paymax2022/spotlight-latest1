// ── Crowdfunding — Campaign creation draft store ─────────────────────────────
// Holds the in-progress wizard draft (Section G). Zustand mirrors the app's
// existing store pattern (see src/store/authStore.ts).

import { create } from 'zustand';
import type {
  CampaignDraftInput,
  DraftBudgetItem,
  DraftMilestone,
  DraftRewardTier,
} from '../types/crowdfunding.types';

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

export const useCampaignDraft = create<DraftState>((set, get) => ({
  draft: { ...emptyDraft },

  patch: (partial) => set((s) => ({ draft: { ...s.draft, ...partial } })),

  addBudgetItem: (item) => set((s) => ({ draft: { ...s.draft, budget: [...s.draft.budget, item] } })),
  removeBudgetItem: (id) => set((s) => ({ draft: { ...s.draft, budget: s.draft.budget.filter((b) => b.id !== id) } })),

  addMilestone: (item) => set((s) => ({ draft: { ...s.draft, milestones: [...s.draft.milestones, item] } })),
  removeMilestone: (id) => set((s) => ({ draft: { ...s.draft, milestones: s.draft.milestones.filter((m) => m.id !== id) } })),

  addRewardTier: (item) => set((s) => ({ draft: { ...s.draft, rewardTiers: [...s.draft.rewardTiers, item] } })),
  removeRewardTier: (id) => set((s) => ({ draft: { ...s.draft, rewardTiers: s.draft.rewardTiers.filter((r) => r.id !== id) } })),

  reset: () => set({ draft: { ...emptyDraft, budget: [], milestones: [], rewardTiers: [], galleryUris: [], documentLabels: [] } }),

  budgetTotalKobo: () => get().draft.budget.reduce((sum, b) => sum + b.amountKobo, 0),
}));
