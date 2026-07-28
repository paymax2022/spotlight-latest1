// ── Doctor module — constants ────────────────────────────────────────────────
// Static option lists used across the doctor (provider-side) screens.
// Pure data only — no money math here. Money is always integers in kobo.

import type {
  VerificationDocType,
  LabTest,
  PrescriptionDrugItem,
  Weekday,
} from '@/types/doctor';

// ─── Specialties & sub-specialties (signup / profile) ────────────────────────

export const SPECIALTY_OPTIONS: { id: string; label: string }[] = [
  { id: 'gp',        label: 'General Practice' },
  { id: 'cardio',    label: 'Cardiology' },
  { id: 'derma',     label: 'Dermatology' },
  { id: 'pediatric', label: 'Pediatrics' },
  { id: 'mental',    label: 'Mental Health' },
  { id: 'ob-gyn',    label: 'OB-GYN' },
  { id: 'dental',    label: 'Dental' },
  { id: 'nutrition', label: 'Nutrition' },
  { id: 'ortho',     label: 'Orthopaedics' },
  { id: 'ent',       label: 'ENT' },
];

export const SUB_SPECIALTY_OPTIONS: string[] = [
  'Family Medicine',
  'Internal Medicine',
  'Chronic Disease Management',
  'Preventive Health',
  'Hypertension',
  'Heart Failure',
  'Cosmetic Care',
  'Neonatology',
  'Psychiatry',
  'Counselling',
  'Oral Health',
];

// ─── Verification documents ──────────────────────────────────────────────────

export const VERIFICATION_DOC_TYPES: { type: VerificationDocType; label: string; required: boolean }[] = [
  { type: 'mdcn_certificate',   label: 'MDCN Certificate',    required: true },
  { type: 'medical_license',    label: 'Medical License',     required: true },
  { type: 'degree_certificate', label: 'Degree Certificate',  required: true },
  { type: 'government_id',      label: 'Government ID (NIN)',  required: true },
  { type: 'passport_photo',    label: 'Passport Photograph',  required: true },
  { type: 'cv',                label: 'Curriculum Vitae',     required: false },
];

// ─── ICD-lite diagnosis options ──────────────────────────────────────────────

export const DIAGNOSIS_OPTIONS: { code: string; label: string }[] = [
  { code: 'I10',   label: 'Essential Hypertension' },
  { code: 'E11',   label: 'Type 2 Diabetes Mellitus' },
  { code: 'J06',   label: 'Acute Upper Respiratory Infection' },
  { code: 'B54',   label: 'Malaria (unspecified)' },
  { code: 'A09',   label: 'Gastroenteritis' },
  { code: 'K21',   label: 'Gastro-oesophageal Reflux Disease' },
  { code: 'L23',   label: 'Contact Dermatitis' },
  { code: 'F41',   label: 'Anxiety Disorder' },
  { code: 'F32',   label: 'Depressive Episode' },
  { code: 'M54',   label: 'Back Pain' },
  { code: 'N39',   label: 'Urinary Tract Infection' },
  { code: 'R51',   label: 'Headache' },
];

// ─── Drug catalogue (prescription authoring) ─────────────────────────────────

export const DRUG_CATALOGUE: { name: string; commonDosages: string[] }[] = [
  { name: 'Paracetamol',  commonDosages: ['500mg', '1000mg'] },
  { name: 'Amoxicillin',  commonDosages: ['250mg', '500mg'] },
  { name: 'Metformin',    commonDosages: ['500mg', '850mg', '1000mg'] },
  { name: 'Amlodipine',   commonDosages: ['5mg', '10mg'] },
  { name: 'Lisinopril',   commonDosages: ['5mg', '10mg', '20mg'] },
  { name: 'Artemether/Lumefantrine', commonDosages: ['20mg/120mg'] },
  { name: 'Omeprazole',   commonDosages: ['20mg', '40mg'] },
  { name: 'Cetirizine',   commonDosages: ['10mg'] },
  { name: 'Ibuprofen',    commonDosages: ['200mg', '400mg'] },
  { name: 'Hydrocortisone 1% cream', commonDosages: ['Apply thin layer'] },
];

export const ROUTE_OPTIONS: string[] = ['Oral', 'Topical', 'Intravenous', 'Intramuscular', 'Inhalation', 'Sublingual'];

export const FREQUENCY_OPTIONS: string[] = [
  'Once daily',
  'Twice daily',
  'Three times daily',
  'Four times daily',
  'Every 6 hours',
  'Every 8 hours',
  'Once at night',
  'As needed',
];

export const DURATION_OPTIONS: string[] = ['3 days', '5 days', '7 days', '10 days', '14 days', '28 days', '30 days', '90 days'];

// A blank drug row to seed a new prescription item.
export const EMPTY_DRUG_ITEM: PrescriptionDrugItem = {
  name: '', dosage: '', route: 'Oral', frequency: 'Twice daily', duration: '5 days',
};

// ─── Lab test catalogue (lab orders) ─────────────────────────────────────────

export const LAB_TEST_CATALOGUE: LabTest[] = [
  { id: 'lt-fbc',   name: 'Full Blood Count',         code: 'FBC',    category: 'Haematology' },
  { id: 'lt-mp',    name: 'Malaria Parasite',         code: 'MP',     category: 'Haematology' },
  { id: 'lt-hba1c', name: 'Glycated Haemoglobin',     code: 'HbA1c',  category: 'Chemistry' },
  { id: 'lt-fbs',   name: 'Fasting Blood Sugar',      code: 'FBS',    category: 'Chemistry' },
  { id: 'lt-lipid', name: 'Lipid Profile',            code: 'LIPID',  category: 'Chemistry' },
  { id: 'lt-lft',   name: 'Liver Function Test',      code: 'LFT',    category: 'Chemistry' },
  { id: 'lt-euc',   name: 'Electrolytes, Urea, Creatinine', code: 'EUC', category: 'Chemistry' },
  { id: 'lt-urin',  name: 'Urinalysis',               code: 'URIN',   category: 'Microbiology' },
  { id: 'lt-hcg',   name: 'Pregnancy Test (β-hCG)',   code: 'hCG',    category: 'Endocrinology' },
  { id: 'lt-tsh',   name: 'Thyroid Function Test',    code: 'TFT',    category: 'Endocrinology' },
];

// ─── Availability scheduling ─────────────────────────────────────────────────

export const WEEKDAYS: { day: Weekday; label: string; short: string }[] = [
  { day: 'mon', label: 'Monday',    short: 'Mon' },
  { day: 'tue', label: 'Tuesday',   short: 'Tue' },
  { day: 'wed', label: 'Wednesday', short: 'Wed' },
  { day: 'thu', label: 'Thursday',  short: 'Thu' },
  { day: 'fri', label: 'Friday',    short: 'Fri' },
  { day: 'sat', label: 'Saturday',  short: 'Sat' },
  { day: 'sun', label: 'Sunday',    short: 'Sun' },
];

export const CONSULT_DURATION_OPTIONS: number[] = [15, 20, 30, 45, 60]; // minutes
export const BUFFER_OPTIONS: number[] = [0, 5, 10, 15];                 // minutes

// ─── Support ─────────────────────────────────────────────────────────────────

export const SUPPORT_CATEGORIES: string[] = ['Payments', 'Technical', 'Account', 'Patients', 'Verification', 'Other'];

// ─── Phase 2 constants ───────────────────────────────────────────────────────
export * from './phase2';

// ─── Section B (Profile & Verification) constants ────────────────────────────
export * from './profile';

// ─── Phase 3 constants (Vet · AI · Practice) ─────────────────────────────────
export * from './phase3';

// ─── Batch 1 constants (Sections C · D · E · F) ──────────────────────────────
export * from './batch1';

// ─── Batch 2 constants (Sections G · H · I · J) ──────────────────────────────
export * from './batch2';

// ─── Batch 3 constants (Sections K · L · M · N) ──────────────────────────────
export * from './batch3';

// ─── Batch 4 constants (Sections O · P · Q · R) ──────────────────────────────
export * from './batch4';

// ─── Batch 5 constants (Sections S · T · U · V — Veterinary) ──────────────────
export * from './batch5';

// ─── Batch 6 constants (Sections W · X · Y · Z) ──────────────────────────────
export * from './batch6';

// ─── Batch 7 constants (Sections AA · AB · AC · AD) ──────────────────────────
export * from './batch7';

// ─── Section A (Onboarding) constants ─────────────────────────────────────────
export * from './onboarding';
