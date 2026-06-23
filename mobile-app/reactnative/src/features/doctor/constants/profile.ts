// ── Doctor module — Section B (Profile & Verification) constants ─────────────
// Static option lists for the 31-screen profile builder & verification flow.
// Pure data only — no money math. Money is always integers in kobo. ADDITIVE to
// `@/features/doctor/constants` (re-exported from its barrel). REUSES
// SPECIALTY_OPTIONS / SUB_SPECIALTY_OPTIONS / VERIFICATION_DOC_TYPES from the
// barrel — do not duplicate those here.

import type {
  ProfileDocType,
  ProfileBuilderStep,
  GenderOption,
} from '@/types/doctor.profile';

// ─── Languages spoken (screen 8) ─────────────────────────────────────────────

export const LANGUAGE_OPTIONS: string[] = [
  'English',
  'Hausa',
  'Yoruba',
  'Igbo',
  'Pidgin',
  'French',
  'Fulfulde',
  'Kanuri',
  'Ibibio',
  'Tiv',
  'Arabic',
];

// ─── Years of experience (screen 7) ──────────────────────────────────────────
// Discrete buckets plus a helper to clamp a free-typed number.

export const EXPERIENCE_OPTIONS: { value: number; label: string }[] = [
  { value: 0,  label: 'Less than 1 year' },
  { value: 1,  label: '1 year' },
  { value: 2,  label: '2 years' },
  { value: 3,  label: '3 years' },
  { value: 5,  label: '5 years' },
  { value: 10, label: '10 years' },
  { value: 15, label: '15 years' },
  { value: 20, label: '20+ years' },
];

export const MAX_YEARS_EXPERIENCE = 60;

export function clampYearsExperience(value: number): number {
  if (Number.isNaN(value) || value < 0) return 0;
  return Math.min(Math.floor(value), MAX_YEARS_EXPERIENCE);
}

// ─── Honorific / title options (screens 1, 2) ────────────────────────────────

export const TITLE_OPTIONS: string[] = ['Dr.', 'Prof.', 'Mr.', 'Mrs.', 'Ms.', 'Mx.'];

// ─── Gender options (screen 2) ───────────────────────────────────────────────

export const GENDER_OPTIONS: { value: GenderOption; label: string }[] = [
  { value: 'male',              label: 'Male' },
  { value: 'female',            label: 'Female' },
  { value: 'other',             label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

// ─── Degree / qualification options (screen 15) ──────────────────────────────

export const DEGREE_OPTIONS: string[] = [
  'MBBS',
  'MBChB',
  'BDS',         // dentistry
  'BPharm',
  'MD',
  'MSc',
  'MPH',
  'FWACP',       // West African College of Physicians fellowship
  'FMCFM',       // National Postgraduate Medical College fellowship
  'FWACS',       // surgery fellowship
  'PhD',
  'Diploma',
  'Other',
];

// ─── Government ID types (screen 11) ─────────────────────────────────────────

export const ID_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'nin',         label: 'National ID (NIN)' },
  { value: 'drivers',     label: "Driver's Licence" },
  { value: 'passport',    label: 'International Passport' },
  { value: 'voters_card', label: "Voter's Card" },
];

// ─── Professional associations (screen 13) ───────────────────────────────────

export const ASSOCIATION_OPTIONS: string[] = [
  'Nigerian Medical Association (NMA)',
  'Medical and Dental Council of Nigeria (MDCN)',
  'Association of General & Private Medical Practitioners (AGPMPN)',
  'West African College of Physicians (WACP)',
  'National Postgraduate Medical College of Nigeria (NPMCN)',
  'Pharmaceutical Society of Nigeria (PSN)',
  'Other',
];

// ─── Profile builder step metadata (screen 1 hub) ────────────────────────────
// Drives the setup hub checklist order + labels. Screen 19 (availability) is
// handled by the existing useAvailability flow; it is included so the hub can
// surface it, but the wizard routes to the existing availability screen.

export const PROFILE_BUILDER_STEPS: { step: ProfileBuilderStep; label: string; screen: number }[] = [
  { step: 'personal_info',   label: 'Personal information',         screen: 2 },
  { step: 'profile_photo',   label: 'Profile photo',                screen: 3 },
  { step: 'bio',             label: 'Professional bio',             screen: 4 },
  { step: 'specialty',       label: 'Medical specialty',            screen: 5 },
  { step: 'sub_specialty',   label: 'Sub-specialty',                screen: 6 },
  { step: 'experience',      label: 'Years of experience',          screen: 7 },
  { step: 'languages',       label: 'Languages spoken',             screen: 8 },
  { step: 'licence_number',  label: 'Medical licence number',       screen: 9 },
  { step: 'licence_upload',  label: 'Upload medical licence',       screen: 10 },
  { step: 'government_id',   label: 'Government ID',                 screen: 11 },
  { step: 'certificates',    label: 'Certificates',                 screen: 12 },
  { step: 'association',     label: 'Association membership',        screen: 13 },
  { step: 'affiliations',    label: 'Hospital/clinic affiliation',  screen: 14 },
  { step: 'education',       label: 'Education history',            screen: 15 },
  { step: 'work_experience', label: 'Work experience',              screen: 16 },
  { step: 'pricing',         label: 'Consultation pricing',         screen: 17 },
  { step: 'free_follow_up',  label: 'Free follow-up policy',        screen: 18 },
  { step: 'availability',    label: 'Availability',                 screen: 19 },
  { step: 'bank_account',    label: 'Bank account',                 screen: 20 },
  { step: 'tax_info',        label: 'Tax / VAT information',        screen: 21 },
];

// ─── Document slot labels (screens 10–13) ────────────────────────────────────
// Section B doc-type labels. Phase 1 VERIFICATION_DOC_TYPES (from the barrel)
// remains the canonical list of *required* verification docs; this maps the
// extended ProfileDocType union (incl. certificate / association_membership).

export const PROFILE_DOC_TYPE_LABELS: Record<ProfileDocType, string> = {
  mdcn_certificate:       'MDCN Certificate',
  medical_license:        'Medical License',
  degree_certificate:     'Degree Certificate',
  government_id:          'Government ID',
  passport_photo:         'Passport Photograph',
  cv:                     'Curriculum Vitae',
  certificate:            'Professional Certificate',
  association_membership: 'Association Membership',
};

// ─── Verification rejection reasons (screens 27, 28) ─────────────────────────

export const REJECTION_REASONS: { code: string; label: string }[] = [
  { code: 'doc_unclear',       label: 'Document image is blurry or unreadable' },
  { code: 'doc_expired',       label: 'Document has expired' },
  { code: 'licence_mismatch',  label: 'Licence number does not match the MDCN register' },
  { code: 'name_mismatch',     label: 'Name on documents does not match' },
  { code: 'incomplete',        label: 'A required document is missing' },
  { code: 'suspected_fraud',   label: 'Document could not be authenticated' },
  { code: 'other',             label: 'Other' },
];

// ─── Bank list (screen 20) — sample of Nigerian banks + CBN codes ────────────

export const BANK_LIST: { name: string; code: string }[] = [
  { name: 'Access Bank',          code: '044' },
  { name: 'Citibank Nigeria',     code: '023' },
  { name: 'Ecobank Nigeria',      code: '050' },
  { name: 'Fidelity Bank',        code: '070' },
  { name: 'First Bank of Nigeria', code: '011' },
  { name: 'First City Monument Bank (FCMB)', code: '214' },
  { name: 'Guaranty Trust Bank (GTBank)', code: '058' },
  { name: 'Keystone Bank',        code: '082' },
  { name: 'Kuda Bank',            code: '50211' },
  { name: 'Opay',                 code: '999992' },
  { name: 'Polaris Bank',         code: '076' },
  { name: 'Providus Bank',        code: '101' },
  { name: 'Stanbic IBTC Bank',    code: '221' },
  { name: 'Standard Chartered',   code: '068' },
  { name: 'Sterling Bank',        code: '232' },
  { name: 'Union Bank',           code: '032' },
  { name: 'United Bank for Africa (UBA)', code: '033' },
  { name: 'Unity Bank',           code: '215' },
  { name: 'Wema Bank',            code: '035' },
  { name: 'Zenith Bank',          code: '057' },
];

// ─── Nigerian states (screens 2, 14) ─────────────────────────────────────────

export const NIGERIAN_STATES: string[] = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
  'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'FCT - Abuja', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina',
  'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo',
  'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];

// ─── Free follow-up policy windows (screen 18) ───────────────────────────────

export const FREE_FOLLOW_UP_WINDOW_OPTIONS: number[] = [3, 5, 7, 14, 30]; // days

// ─── Consult-fee presets (screen 17) — kobo ──────────────────────────────────
// Suggested price points so the pricing screen can offer quick chips. All kobo.

export const CONSULT_FEE_PRESETS_KOBO: number[] = [200000, 300000, 350000, 500000, 750000, 1000000];
