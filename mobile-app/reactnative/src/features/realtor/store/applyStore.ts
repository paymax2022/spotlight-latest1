// ── Spotlight Realtor — Rental application draft store ───────────────────────
// Holds the in-progress application across the apply → review → submit steps
// (zustand, matching authStore usage). Cleared after a successful submit.

import { create } from 'zustand';
import type { ApplicationDraft, EmploymentStatus } from '../types/realtor.types';

const empty: ApplicationDraft = {
  listingId: '',
  fullName: '',
  email: '',
  phone: '',
  occupants: 1,
  moveInDate: '',
  employmentStatus: 'employed',
  employerName: '',
  monthlyIncome: 0,
  guarantorName: '',
  guarantorPhone: '',
  guarantorRelationship: '',
  screeningConsent: false,
};

interface ApplyState {
  draft: ApplicationDraft;
  set: (patch: Partial<ApplicationDraft>) => void;
  init: (listingId: string, inspectionId?: string) => void;
  reset: () => void;
}

export const useApplyStore = create<ApplyState>((set) => ({
  draft: { ...empty },
  set: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
  init: (listingId, inspectionId) =>
    set({ draft: { ...empty, listingId, inspectionId } }),
  reset: () => set({ draft: { ...empty } }),
}));

export const EMPLOYMENT_OPTIONS: { value: EmploymentStatus; label: string }[] = [
  { value: 'employed', label: 'Employed' },
  { value: 'self_employed', label: 'Self-employed' },
  { value: 'business_owner', label: 'Business owner' },
  { value: 'student', label: 'Student' },
  { value: 'unemployed', label: 'Unemployed' },
];
