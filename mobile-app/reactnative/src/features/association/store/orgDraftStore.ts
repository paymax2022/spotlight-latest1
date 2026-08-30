// ── Association — Organisation creation draft store (U) ───────────────────────
// Zustand draft store mirroring the crowdfunding campaign-draft pattern.

import { create } from 'zustand';
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

export const useOrgDraft = create<OrgDraftState>((set) => ({
  draft: { ...emptyDraft },
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
}));
