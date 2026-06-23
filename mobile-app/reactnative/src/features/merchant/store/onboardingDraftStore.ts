// ── Merchant Onboarding — wizard draft store ─────────────────────────────────
// Holds the in-progress application data + current step for the dynamic wizard.
// Zustand mirrors the app's existing store pattern (authStore, campaignDraftStore).

import { create } from 'zustand';
import type { ApplicationData, FieldValue } from '@/types/merchant';

interface DraftState {
  applicationId: string | null;
  stepIndex:     number;
  data:          ApplicationData;
  /** Load an application's saved data into the wizard (resume — FR-11). */
  hydrate: (applicationId: string, data: ApplicationData) => void;
  setField: (key: string, value: FieldValue) => void;
  setStep:  (index: number) => void;
  reset:    () => void;
}

export const useOnboardingDraft = create<DraftState>((set) => ({
  applicationId: null,
  stepIndex:     0,
  data:          {},

  hydrate: (applicationId, data) => set({ applicationId, data: { ...data }, stepIndex: 0 }),
  setField: (key, value) => set((s) => ({ data: { ...s.data, [key]: value } })),
  setStep:  (index) => set({ stepIndex: Math.max(0, index) }),
  reset:    () => set({ applicationId: null, stepIndex: 0, data: {} }),
}));
