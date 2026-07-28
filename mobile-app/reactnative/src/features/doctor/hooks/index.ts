// ── Doctor — hooks barrel ────────────────────────────────────────────────────

export * from './useDoctorProfile';
export * from './useAppointments';
export * from './useConsultation';
export * from './useClinical';
export * from './useEarnings';
export * from './useAccount';

// ── Phase 2 ──────────────────────────────────────────────────────────────────
export * from './usePharmacy';
export * from './useReferrals';
export * from './useRecords';
export * from './useReputation';
export * from './useCompliance';

// ── Section B (Profile & Verification) ───────────────────────────────────────
export * from './useProfileBuilder';

// ── Phase 3 (Vet mode · AI assist · Practice management) ──────────────────────
export * from './useVet';
export * from './useAiAssist';
export * from './usePractice';

// ── Batch 1 (Sections C · D · E · F) ──────────────────────────────────────────
export * from './useVetProfile';
export * from './useDashboard';
export * from './useSchedule';
export * from './useQueue';

// ── Batch 2 (Sections G · H · I · J) ──────────────────────────────────────────
export * from './usePatientReview';
export * from './useChatConsult';
export * from './useCall';
export * from './useClinicalNote';

// ── Batch 3 (Sections K · L · M · N) ──────────────────────────────────────────
export * from './useEprescription';
export * from './usePharmacyFulfil';
export * from './useLabOrdering';
export * from './useLabResults';

// ── Batch 4 (Sections O · P · Q · R) ──────────────────────────────────────────
export * from './useHmo';
export * from './useCollaboration';
export * from './useFollowUpCare';
export * from './useEmergency';

// ── Batch 5 (Sections S · T · U · V — Veterinary) ─────────────────────────────
export * from './useVetConsult';
export * from './usePetRx';
export * from './usePetHealth';
export * from './usePetStore';

// ── Batch 6 (Sections W · X · Y · Z — Records · Notifications · Wallet · Reputation) ──
export * from './useMedicalRecords';
export * from './useNotificationsCenter';
export * from './useWallet';
export * from './useReputationCenter';

// ── Batch 7 (Sections AA · AB · AC · AD — Support · Compliance · Settings · Edge-State) ──
export * from './useSupportCenter';
export * from './useComplianceCenter';
export * from './useSettingsCenter';
export * from './useAppStatus';

// ── Section A (Splash · Onboarding · Authentication) ──────────────────────────
export * from './useOnboarding';
