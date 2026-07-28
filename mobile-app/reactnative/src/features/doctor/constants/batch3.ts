// ── Doctor module — Batch 3 (sections K · L · M · N) constants ────────────────
// Static option lists for the Batch 3 provider-side screens (e-prescription,
// pharmacy & drug fulfilment, lab test ordering, lab result review). Pure data
// only — no money math. Money is always integers in kobo. ADDITIVE to
// `@/features/doctor/constants` (re-exported from its barrel). REUSES
// DRUG_CATALOGUE / ROUTE_OPTIONS / FREQUENCY_OPTIONS / DURATION_OPTIONS /
// LAB_TEST_CATALOGUE from the barrel — do not duplicate those here.

import type {
  DosageForm,
  FoodTiming,
  RxWarningKind,
  RxWarningSeverity,
  RxLifecycleStatus,
  RxAuditAction,
  DrugCatalogueEntry,
  DrugAlternative,
  StockLevel,
  FulfilmentStatusExt,
  SampleType,
  LabUrgency,
  CollectionMode,
  LabPackage,
  LabResultStatus,
  LabResultValueRich,
  LabResultAuditAction,
} from '@/types/doctor.batch3';

// ═══════════════════════════════════════════════════════════════════════════
// SECTION K — e-prescription
// ═══════════════════════════════════════════════════════════════════════════

// Dosage-form options (drives the dosage-form picker in the rx builder).
export const DOSAGE_FORM_OPTIONS: { value: DosageForm; label: string }[] = [
  { value: 'tablet',       label: 'Tablet' },
  { value: 'capsule',      label: 'Capsule' },
  { value: 'syrup',        label: 'Syrup' },
  { value: 'suspension',   label: 'Suspension' },
  { value: 'injection',    label: 'Injection' },
  { value: 'cream',        label: 'Cream' },
  { value: 'ointment',     label: 'Ointment' },
  { value: 'drops',        label: 'Drops' },
  { value: 'inhaler',      label: 'Inhaler' },
  { value: 'suppository',  label: 'Suppository' },
];

// Strength presets (free-text still allowed; these seed the quick-pick chips).
export const STRENGTH_OPTIONS: string[] = [
  '5mg', '10mg', '20mg', '25mg', '40mg', '50mg', '100mg',
  '125mg', '250mg', '500mg', '850mg', '1000mg',
  '5ml', '10ml', '0.5%', '1%', '2%',
];

// Food-timing options (before / after / with food, or no restriction).
export const FOOD_TIMING_OPTIONS: { value: FoodTiming; label: string }[] = [
  { value: 'before_food', label: 'Before food' },
  { value: 'after_food',  label: 'After food' },
  { value: 'with_food',   label: 'With food' },
  { value: 'any',         label: 'No restriction' },
];

// Safety-warning kind labels (the warning banner header copy).
export const RX_WARNING_LABELS: Record<RxWarningKind, string> = {
  interaction:             'Drug interaction',
  duplicate:               'Duplicate therapy',
  contraindication:        'Contraindication',
  controlled:              'Controlled substance',
  pregnancy_breastfeeding: 'Pregnancy / breastfeeding',
  paediatric_dose:         'Paediatric dosing',
  elderly_dose:            'Elderly dosing',
};

// Safety-warning severity tones (shared banner tone keys).
export const RX_WARNING_TONES: Record<RxWarningSeverity, { label: string; tone: string }> = {
  info:     { label: 'Note',     tone: 'info' },
  warning:  { label: 'Caution',  tone: 'warning' },
  critical: { label: 'Critical', tone: 'danger' },
};

// Prescription lifecycle labels (draft → preview → signed → issued → …).
export const RX_LIFECYCLE_LABELS: Record<RxLifecycleStatus, string> = {
  draft:     'Draft',
  preview:   'Preview',
  signed:    'Signed',
  issued:    'Issued',
  expired:   'Expired',
  cancelled: 'Cancelled',
};

// Prescription audit-action labels (the audit-trail row copy).
export const AUDIT_ACTION_LABELS: Record<RxAuditAction, string> = {
  created:          'Created',
  edited:           'Edited',
  previewed:        'Previewed',
  signed:           'Digitally signed',
  issued:           'Issued',
  shared:           'Shared with patient',
  sent_to_pharmacy: 'Sent to pharmacy',
  refill_requested: 'Refill requested',
  cancelled:        'Cancelled',
  expired:          'Expired',
};

// Richer drug catalogue (strengths + dosage forms + controlled/OTC flags) for
// the warning engine. Superset of the barrel's DRUG_CATALOGUE (name+dosages),
// which is reused for the lightweight name/dosage picker — this is Section K's
// source of truth for forms, controlled status and the alternatives lookup.
export const DRUG_CATALOGUE_RICH: DrugCatalogueEntry[] = [
  { id: 'dc-para', name: 'Paracetamol',  strengths: ['500mg', '1000mg'],          forms: ['tablet', 'syrup', 'suppository'], isControlled: false, isOtc: true,  classLabel: 'Analgesic / antipyretic' },
  { id: 'dc-amox', name: 'Amoxicillin',  strengths: ['250mg', '500mg'],           forms: ['capsule', 'suspension'],          isControlled: false, isOtc: false, classLabel: 'Penicillin antibiotic' },
  { id: 'dc-metf', name: 'Metformin',    strengths: ['500mg', '850mg', '1000mg'], forms: ['tablet'],                         isControlled: false, isOtc: false, classLabel: 'Biguanide antidiabetic' },
  { id: 'dc-amlo', name: 'Amlodipine',   strengths: ['5mg', '10mg'],              forms: ['tablet'],                         isControlled: false, isOtc: false, classLabel: 'Calcium-channel blocker' },
  { id: 'dc-lisi', name: 'Lisinopril',   strengths: ['5mg', '10mg', '20mg'],      forms: ['tablet'],                         isControlled: false, isOtc: false, classLabel: 'ACE inhibitor' },
  { id: 'dc-omep', name: 'Omeprazole',   strengths: ['20mg', '40mg'],             forms: ['capsule'],                        isControlled: false, isOtc: true,  classLabel: 'Proton-pump inhibitor' },
  { id: 'dc-ibup', name: 'Ibuprofen',    strengths: ['200mg', '400mg'],           forms: ['tablet', 'syrup'],                isControlled: false, isOtc: true,  classLabel: 'NSAID' },
  { id: 'dc-ceti', name: 'Cetirizine',   strengths: ['10mg'],                     forms: ['tablet', 'syrup'],                isControlled: false, isOtc: true,  classLabel: 'Antihistamine' },
  { id: 'dc-cdne', name: 'Codeine',      strengths: ['15mg', '30mg'],             forms: ['tablet'],                         isControlled: true,  isOtc: false, classLabel: 'Opioid analgesic (controlled)' },
  { id: 'dc-diaz', name: 'Diazepam',     strengths: ['2mg', '5mg'],               forms: ['tablet'],                         isControlled: true,  isOtc: false, classLabel: 'Benzodiazepine (controlled)' },
];

// Generic / brand alternatives lookup (alternatives sheet in the rx builder).
export const DRUG_ALTERNATIVES: DrugAlternative[] = [
  { id: 'alt-1', forDrug: 'Lisinopril', name: 'Enalapril',     kind: 'generic', strength: '10mg', priceKobo: 90000,  note: 'Equivalent ACE inhibitor' },
  { id: 'alt-2', forDrug: 'Lisinopril', name: 'Zestril',       kind: 'brand',   strength: '10mg', priceKobo: 180000, note: 'Brand of lisinopril' },
  { id: 'alt-3', forDrug: 'Amlodipine', name: 'Norvasc',       kind: 'brand',   strength: '5mg',  priceKobo: 220000, note: 'Brand of amlodipine' },
  { id: 'alt-4', forDrug: 'Paracetamol', name: 'Panadol',      kind: 'brand',   strength: '500mg', priceKobo: 60000, note: 'Brand of paracetamol' },
  { id: 'alt-5', forDrug: 'Omeprazole', name: 'Losec',         kind: 'brand',   strength: '20mg', priceKobo: 150000, note: 'Brand of omeprazole' },
];

// Fulfilment-option labels (the send-to-pharmacy options).
export const RX_FULFILMENT_OPTION_LABELS: Record<string, string> = {
  send_to_pharmacy: 'Send to a pharmacy',
  patient_choice:   'Let patient choose pharmacy',
  print:            'Print / download',
  share:            'Share code with patient',
};

// Default prescription validity (days) — drives the expired state.
export const RX_VALIDITY_DAYS: number = 30;

// Reasons for cancelling an issued prescription.
export const RX_CANCEL_REASONS: string[] = [
  'Prescribed in error',
  'Patient declined',
  'Changed treatment plan',
  'Drug unavailable',
  'Duplicate prescription',
  'Other',
];

// ═══════════════════════════════════════════════════════════════════════════
// SECTION L — pharmacy & drug fulfilment
// ═══════════════════════════════════════════════════════════════════════════

// Drug stock-level labels + tone keys (drug-unavailable alert source).
export const STOCK_LEVEL_LABELS: Record<StockLevel, { label: string; tone: string }> = {
  in_stock:     { label: 'In stock',     tone: 'success' },
  low_stock:    { label: 'Low stock',    tone: 'warning' },
  out_of_stock: { label: 'Out of stock', tone: 'danger' },
};

// Extended fulfilment-status labels (covers Phase 2 states + the Batch 3 additions).
export const FULFILMENT_STATUS_LABELS: Record<FulfilmentStatusExt, string> = {
  // Phase 2 core states (reused union members)
  received:             'Received',
  substitute_requested: 'Substitute requested',
  preparing:            'Preparing',
  ready:                'Ready',
  dispensed:            'Dispensed',
  cancelled:            'Cancelled',
  // Batch 3 additions
  partial:              'Partially dispensed',
  awaiting_payment:     'Awaiting payment',
  awaiting_hmo:         'Awaiting HMO',
  awaiting_delivery:    'Awaiting delivery',
  received_by_patient:  'Received by patient',
};

// Reasons for reporting / complaining about a pharmacy.
export const PHARMACY_REPORT_REASONS: string[] = [
  'Wrong medication dispensed',
  'Substitution without approval',
  'Excessive delay',
  'Overcharged',
  'Expired stock',
  'Unprofessional conduct',
  'Other',
];

// ═══════════════════════════════════════════════════════════════════════════
// SECTION M — lab test ordering
// ═══════════════════════════════════════════════════════════════════════════

// Sample-type labels + collection instruction copy.
export const SAMPLE_TYPE_OPTIONS: { value: SampleType; label: string; instruction: string }[] = [
  { value: 'blood',  label: 'Blood',  instruction: 'Venous blood sample drawn by the lab.' },
  { value: 'urine',  label: 'Urine',  instruction: 'Mid-stream urine sample in a sterile container.' },
  { value: 'stool',  label: 'Stool',  instruction: 'Fresh stool sample in a sterile container.' },
  { value: 'swab',   label: 'Swab',   instruction: 'Swab collected by the lab technician.' },
  { value: 'sputum', label: 'Sputum', instruction: 'Early-morning deep-cough sputum sample.' },
  { value: 'saliva', label: 'Saliva', instruction: 'Saliva sample as directed.' },
  { value: 'tissue', label: 'Tissue', instruction: 'Tissue sample collected during a procedure.' },
];

// Urgency labels + tone keys (routine / urgent / stat).
export const URGENCY_OPTIONS: { value: LabUrgency; label: string; tone: string }[] = [
  { value: 'routine', label: 'Routine', tone: 'muted' },
  { value: 'urgent',  label: 'Urgent',  tone: 'warning' },
  { value: 'stat',    label: 'STAT (immediate)', tone: 'danger' },
];

// Collection-mode labels (lab visit vs home collection).
export const COLLECTION_OPTIONS: { value: CollectionMode; label: string; detail: string }[] = [
  { value: 'lab_visit',       label: 'Lab visit',       detail: 'Patient visits the lab to give the sample.' },
  { value: 'home_collection', label: 'Home collection', detail: 'A phlebotomist collects the sample at home.' },
];

// Fasting instruction copy (shown when a test / package requires fasting).
export const FASTING_INSTRUCTION =
  'Patient should fast for the required hours (water permitted) before sample collection.';

// Bundled lab packages (member test ids resolve to LAB_TEST_CATALOGUE entries).
export const LAB_PACKAGES: LabPackage[] = [
  {
    id: 'pkg-diabetes', name: 'Diabetes Profile',
    description: 'Fasting blood sugar, HbA1c and lipid profile for diabetes monitoring.',
    testIds: ['lt-fbs', 'lt-hba1c', 'lt-lipid'], priceKobo: 1200000, fastingRequired: true,
  },
  {
    id: 'pkg-wellness', name: 'Basic Wellness Panel',
    description: 'Full blood count, liver and kidney function for a routine health check.',
    testIds: ['lt-fbc', 'lt-lft', 'lt-euc'], priceKobo: 1500000, fastingRequired: false,
  },
  {
    id: 'pkg-cardiac', name: 'Cardiac Risk Panel',
    description: 'Lipid profile and electrolytes to assess cardiovascular risk.',
    testIds: ['lt-lipid', 'lt-euc'], priceKobo: 900000, fastingRequired: true,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// SECTION N — lab result review
// ═══════════════════════════════════════════════════════════════════════════

// Result-status labels + tone keys (pending / ready / delayed).
export const RESULT_STATUS_LABELS: Record<LabResultStatus, { label: string; tone: string }> = {
  pending: { label: 'Pending', tone: 'muted' },
  ready:   { label: 'Ready',   tone: 'success' },
  delayed: { label: 'Delayed', tone: 'warning' },
};

// Result value flag labels + tone keys (normal / low / high) — mirrors the
// Phase 1 `LabResultValue.flag` union, with an extra abnormal/critical emphasis.
export const RESULT_FLAG_LABELS: Record<LabResultValueRich['base']['flag'], { label: string; tone: string }> = {
  normal: { label: 'Normal', tone: 'success' },
  low:    { label: 'Low',    tone: 'warning' },
  high:   { label: 'High',   tone: 'warning' },
};

// Result audit-action labels (the result audit-trail row copy).
export const RESULT_AUDIT_ACTION_LABELS: Record<LabResultAuditAction, string> = {
  viewed:           'Viewed',
  reviewed:         'Marked reviewed',
  interpreted:      'Interpretation added',
  shared:           'Explanation shared',
  repeat_requested: 'Repeat test requested',
  reported:         'Reported as suspicious',
};

// Reasons for reporting a suspicious / implausible lab result.
export const SUSPICIOUS_RESULT_REASONS: string[] = [
  'Result inconsistent with clinical picture',
  'Implausible value',
  'Possible sample mix-up',
  'Possible lab error',
  'Reference range looks wrong',
  'Other',
];
