// ── Doctor module — Section A (Onboarding) constants ─────────────────────────
// Static option lists / labels for the splash, onboarding & authentication
// funnel. Pure data only — no money math. ADDITIVE; re-exported from
// constants/index.ts via a single new line.

import type {
  ProviderTypeOption,
  LegalDocKind,
  AppPermissionKind,
  OnboardingSlide,
} from '@/types/doctor.onboarding';

// Re-export the static intro-carousel content from the api so a screen can pull
// either the demo data or this constant — single source of truth lives in the api.
export { DEMO_ONBOARDING_SLIDES as ONBOARDING_SLIDES } from '@/api/doctor.onboarding.api';

// ─── Entry 4 — provider type choices ─────────────────────────────────────────
// `routesTo` documents which existing builder each choice opens (Frontend uses
// it to navigate): doctor & specialist → Section B builder; veterinarian →
// Section C / Batch 1 builder.

export const PROVIDER_TYPE_OPTIONS: ProviderTypeOption[] = [
  {
    type: 'doctor', label: 'Doctor (General Practice)',
    description: 'Provide general medical consultations and care to patients.',
    icon: 'medkit-outline', routesTo: 'doctor_profile_builder',
  },
  {
    type: 'specialist', label: 'Specialist Doctor',
    description: 'Practise within a recognised specialty (cardiology, dermatology, etc.).',
    icon: 'pulse-outline', routesTo: 'doctor_profile_builder',
  },
  {
    type: 'veterinarian', label: 'Veterinary Doctor',
    description: 'Provide veterinary consultations and care for animals.',
    icon: 'paw-outline', routesTo: 'vet_profile_builder',
  },
];

// ─── Entries 8–12 — legal document labels ────────────────────────────────────

export const LEGAL_DOC_LABELS: Record<LegalDocKind, string> = {
  terms_of_service:      'Terms of Service',
  medical_privacy:       'Medical Privacy Notice',
  hipaa_data_protection: 'Data Protection Acknowledgement',
  professional_conduct:  'Professional Conduct Agreement',
  telemedicine_policy:   'Telemedicine Policy',
};

// Ordered list so the consent screen can render the five docs deterministically.
export const LEGAL_DOC_ORDER: LegalDocKind[] = [
  'terms_of_service',
  'medical_privacy',
  'hipaa_data_protection',
  'professional_conduct',
  'telemedicine_policy',
];

// ─── Entries 13–16 — permission labels + rationale copy ──────────────────────
// `rationale` is the pre-prompt explanation the Frontend shows before triggering
// the OS permission dialog. `required` mirrors the api's required flag.

export const PERMISSION_LABELS: Record<AppPermissionKind, { label: string; rationale: string; icon: string; required: boolean }> = {
  notification: {
    label: 'Notifications',
    rationale: 'Get alerted about new bookings, patient messages and payout updates.',
    icon: 'notifications-outline', required: false,
  },
  camera: {
    label: 'Camera',
    rationale: 'Needed for video consultations with your patients.',
    icon: 'videocam-outline', required: true,
  },
  microphone: {
    label: 'Microphone',
    rationale: 'Needed so patients can hear you during audio and video consults.',
    icon: 'mic-outline', required: true,
  },
  location: {
    label: 'Location',
    rationale: 'Used to show nearby labs and pharmacies for your patients.',
    icon: 'location-outline', required: false,
  },
};

// Ordered list so the permissions onboarding step renders deterministically.
export const PERMISSION_ORDER: AppPermissionKind[] = ['notification', 'camera', 'microphone', 'location'];

// Type-only re-export so screens can grab the slide type alongside the constant.
export type { OnboardingSlide };
