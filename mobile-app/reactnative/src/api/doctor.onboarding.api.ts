// ── Doctor (Telemedicine, provider-side) — Section A API client ──────────────
// Section A = Splash, Onboarding & Authentication (20 entries). Phase A style:
// every function resolves demo data so screens render without a live API;
// `DEMO_*` exports double as `placeholderData` in useQuery. ADDITIVE to all
// earlier api files — nothing earlier changes.
//
// Each function branches on `DOCTOR_USE_MOCK` (from doctor.client.ts): the MOCK
// branch returns demo data via `wait()`, the LIVE branch calls the real backend
// under `/api/v1/doctor` via the shared doctorGet/doctorPost helpers. Mutations
// pass the `Idempotency-Key` header through doctorPost.
//
// CONSOLIDATED + heavy REUSE:
//   - Entries 5/6 (doctor / specialist profile update) REUSE Section B
//     (doctor.profile.api + useProfileBuilder) — no api here.
//   - Entry 7 (veterinary profile update) REUSES Section C / Batch 1
//     (doctor.batch1.api + useVetProfile) — no api here.
//   - Entries 17–20 (account pending / rejected / suspended / under review)
//     REUSE Batch 7 getAccountStatus / useAccountStatus — re-exported below, no
//     new account-status fn is added.
// Money is always an integer in kobo (Section A has no money fields).

import { DOCTOR_USE_MOCK, doctorGet, doctorPost } from '@/api/doctor.client';
// Re-export the shared money formatter so Section A screens can import it here too.
export { formatKobo } from '@/api/doctor.api';
// Re-export the REUSED Batch 7 account-status read so entries 17–20 pull the
// account state from a single import site (no re-implementation).
export { getAccountStatus, DEMO_ACCOUNT_STATUS } from '@/api/doctor.batch7.api';

import type {
  OnboardingSlide,
  MerchantUpgradeStatus,
  ConsentStatus,
  LegalDocument,
  LegalDocKind,
  LegalConsentRecord,
  PermissionStates,
  AppPermissionStatus,
  RequestMerchantUpgradeInput,
  RequestMerchantUpgradeResult,
  SelectProviderTypeInput,
  SelectProviderTypeResult,
  AcceptConsentInput,
  AcceptConsentResult,
  RecordPermissionDecisionInput,
  RecordPermissionDecisionResult,
} from '@/types/doctor.onboarding';

// Simulate network latency so loading states are exercised in the UI.
const wait = <T>(value: T, ms = 350): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86400000).toISOString();

// ═══════════════════════════════════════════════════════════════════════════
// ENTRY 2 — APP INTRO CAROUSEL
// ═══════════════════════════════════════════════════════════════════════════

export const DEMO_ONBOARDING_SLIDES: OnboardingSlide[] = [
  { id: 'sl-1', title: 'Practise from anywhere',
    body: 'Run video, audio and chat consultations with patients across Nigeria, on your schedule.',
    icon: 'medkit-outline', accent: 'primary' },
  { id: 'sl-2', title: 'Prescribe & order with confidence',
    body: 'Issue e-prescriptions, order lab tests and review results — all in one place.',
    icon: 'document-text-outline', accent: 'info' },
  { id: 'sl-3', title: 'Get paid, transparently',
    body: 'Track earnings, commission and tax, and receive payouts to your verified bank account.',
    icon: 'cash-outline', accent: 'success' },
  { id: 'sl-4', title: 'Stay compliant',
    body: 'Built-in MDCN/VCN verification, audit trails and data protection keep you covered.',
    icon: 'shield-checkmark-outline', accent: 'warning' },
];

// ═══════════════════════════════════════════════════════════════════════════
// ENTRIES 3 & 4 — UPGRADE TO MERCHANT + PROVIDER TYPE
// ═══════════════════════════════════════════════════════════════════════════

export const DEMO_MERCHANT_UPGRADE_STATUS: MerchantUpgradeStatus = {
  state: 'not_started',
  updatedAt: iso(0),
};

// ═══════════════════════════════════════════════════════════════════════════
// ENTRIES 8–12 — LEGAL CONSENTS
// ═══════════════════════════════════════════════════════════════════════════

const LEGAL_DOCS_BY_KIND: Record<LegalDocKind, LegalDocument> = {
  terms_of_service: {
    kind: 'terms_of_service', version: '2026.1', title: 'Terms of Service',
    summary: 'The agreement governing your use of the Spotlight provider platform.',
    bodyMarkdown: '## Terms of Service\n\nBy using Spotlight as a healthcare provider you agree to deliver care lawfully, maintain a valid practising licence, and abide by the platform policies referenced herein.',
    sections: [
      { heading: 'Eligibility', body: 'You must hold a valid licence to practise in Nigeria.' },
      { heading: 'Use of the platform', body: 'You will use Spotlight only for lawful provision of care.' },
      { heading: 'Termination', body: 'We may suspend accounts that breach these terms.' },
    ],
    effectiveDate: '2026-01-01',
  },
  medical_privacy: {
    kind: 'medical_privacy', version: '2026.1', title: 'Medical Privacy Notice',
    summary: 'How patient health information is collected, used and protected.',
    bodyMarkdown: '## Medical Privacy Notice\n\nPatient health information is confidential. You agree to access it only for the patient in your care and to keep it secure.',
    sections: [
      { heading: 'Confidentiality', body: 'Access patient data only on a need-to-know basis.' },
      { heading: 'Retention', body: 'Records are retained per Nigerian medical record rules.' },
    ],
    effectiveDate: '2026-01-01',
  },
  hipaa_data_protection: {
    kind: 'hipaa_data_protection', version: '2026.1', title: 'Data Protection Acknowledgement',
    summary: 'Your responsibilities under NDPR / data-protection standards.',
    bodyMarkdown: '## Data Protection Acknowledgement\n\nYou acknowledge your obligations under the Nigeria Data Protection Regulation (NDPR) and equivalent standards when handling personal and health data.',
    sections: [
      { heading: 'Lawful basis', body: 'Process personal data only with a lawful basis.' },
      { heading: 'Breach reporting', body: 'Report any suspected data breach immediately.' },
    ],
    effectiveDate: '2026-01-01',
  },
  professional_conduct: {
    kind: 'professional_conduct', version: '2026.1', title: 'Professional Conduct Agreement',
    summary: 'The standards of professional behaviour expected of you.',
    bodyMarkdown: '## Professional Conduct Agreement\n\nYou agree to uphold the MDCN/VCN code of conduct, treat patients with respect, and avoid conflicts of interest.',
    sections: [
      { heading: 'Code of conduct', body: 'Adhere to your professional body’s code.' },
      { heading: 'Conflicts of interest', body: 'Disclose any conflict that may affect care.' },
    ],
    effectiveDate: '2026-01-01',
  },
  telemedicine_policy: {
    kind: 'telemedicine_policy', version: '2026.1', title: 'Telemedicine Policy',
    summary: 'Rules specific to delivering care remotely on Spotlight.',
    bodyMarkdown: '## Telemedicine Policy\n\nYou agree to practise within the limits of telemedicine, escalate to in-person care when appropriate, and document each remote consultation.',
    sections: [
      { heading: 'Scope of remote care', body: 'Refer for in-person care when remote care is unsafe.' },
      { heading: 'Documentation', body: 'Document every consultation in the clinical record.' },
    ],
    effectiveDate: '2026-01-01',
  },
};

export const DEMO_LEGAL_DOCUMENTS: Record<LegalDocKind, LegalDocument> = LEGAL_DOCS_BY_KIND;

// Demo consent status: terms + medical-privacy already accepted, the other three
// outstanding — exercises both the accepted-row and outstanding-row UI.
export const DEMO_CONSENT_STATUS: ConsentStatus = {
  accepted: [
    { kind: 'terms_of_service', version: '2026.1', acceptedAt: iso(2) },
    { kind: 'medical_privacy',  version: '2026.1', acceptedAt: iso(2) },
  ],
  outstanding: ['hipaa_data_protection', 'professional_conduct', 'telemedicine_policy'],
  allAccepted: false,
  updatedAt: iso(2),
};

// ═══════════════════════════════════════════════════════════════════════════
// ENTRIES 13–16 — OS PERMISSIONS
// ═══════════════════════════════════════════════════════════════════════════

export const DEMO_PERMISSION_STATES: PermissionStates = {
  permissions: [
    { kind: 'notification', state: 'undetermined', required: false },
    { kind: 'camera',       state: 'granted',      required: true,  decidedAt: iso(1) },
    { kind: 'microphone',   state: 'granted',      required: true,  decidedAt: iso(1) },
    { kind: 'location',     state: 'undetermined', required: false },
  ],
  updatedAt: iso(1),
};

// ═══════════════════════════════════════════════════════════════════════════
// READ ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// ── Entry 2 ──
export async function getOnboardingSlides(): Promise<OnboardingSlide[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_ONBOARDING_SLIDES);
  return doctorGet<OnboardingSlide[]>('/onboarding/slides');
}

// ── Entries 3 & 4 ──
export async function getMerchantUpgradeStatus(): Promise<MerchantUpgradeStatus> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_MERCHANT_UPGRADE_STATUS);
  return doctorGet<MerchantUpgradeStatus>('/onboarding/merchant-upgrade');
}

// ── Entries 8–12 ──
export async function getLegalDocument(kind: LegalDocKind): Promise<LegalDocument> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_LEGAL_DOCUMENTS[kind]);
  return doctorGet<LegalDocument>('/onboarding/legal', { kind });
}

export async function getConsentStatus(): Promise<ConsentStatus> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_CONSENT_STATUS);
  return doctorGet<ConsentStatus>('/onboarding/consents');
}

// ── Entries 13–16 ──
export async function getPermissionStates(): Promise<PermissionStates> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PERMISSION_STATES);
  return doctorGet<PermissionStates>('/onboarding/permissions');
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

// ── Entry 3 — request user→merchant (provider) upgrade ──
export async function requestMerchantUpgrade(input: RequestMerchantUpgradeInput): Promise<RequestMerchantUpgradeResult> {
  if (DOCTOR_USE_MOCK) {
    void input.idempotencyKey;
    const status: MerchantUpgradeStatus = {
      state: 'in_progress', startedAt: iso(0), updatedAt: iso(0),
    };
    return wait({ status }, 500);
  }
  return doctorPost<RequestMerchantUpgradeResult>('/onboarding/merchant-upgrade', input, input.idempotencyKey);
}

// ── Entry 4 — choose provider type ──
export async function selectProviderType(input: SelectProviderTypeInput): Promise<SelectProviderTypeResult> {
  if (DOCTOR_USE_MOCK) {
    const status: MerchantUpgradeStatus = {
      state: 'type_selected', selectedType: input.type, startedAt: iso(0), updatedAt: iso(0),
    };
    return wait({ status }, 500);
  }
  return doctorPost<SelectProviderTypeResult>('/onboarding/provider-type', input, input.idempotencyKey);
}

// ── Entries 8–12 — accept a legal document (versioned) ──
export async function acceptConsent(input: AcceptConsentInput): Promise<AcceptConsentResult> {
  if (DOCTOR_USE_MOCK) {
    const record: LegalConsentRecord = {
      kind: input.kind, version: input.version, acceptedAt: iso(0),
    };
    // Fold the new acceptance into the demo status (de-dupe by kind).
    const accepted = [
      ...DEMO_CONSENT_STATUS.accepted.filter((c) => c.kind !== input.kind),
      record,
    ];
    const outstanding = DEMO_CONSENT_STATUS.outstanding.filter((k) => k !== input.kind);
    const status: ConsentStatus = {
      accepted, outstanding, allAccepted: outstanding.length === 0, updatedAt: iso(0),
    };
    return wait({ record, status }, 500);
  }
  return doctorPost<AcceptConsentResult>('/onboarding/consents', input, input.idempotencyKey);
}

// ── Entries 13–16 — record an OS permission decision ──
export async function recordPermissionDecision(input: RecordPermissionDecisionInput): Promise<RecordPermissionDecisionResult> {
  if (DOCTOR_USE_MOCK) {
    const required = input.kind === 'camera' || input.kind === 'microphone';
    const permission: AppPermissionStatus = {
      kind: input.kind, state: input.state, required, decidedAt: iso(0),
    };
    return wait({ permission }, 400);
  }
  return doctorPost<RecordPermissionDecisionResult>('/onboarding/permissions', input, input.idempotencyKey);
}
