// ── Doctor module — Phase 3 constants ────────────────────────────────────────
// Static option lists for the Phase 3 provider-side screens (veterinary mode,
// AI assistance, practice management). Pure data only — no money math. Money is
// always integers in kobo. ADDITIVE to `@/features/doctor/constants`
// (re-exported from its barrel).

import type {
  PetSpecies,
  PetDrugCategory,
  PetDrug,
  PetLabTest,
  PetProductCategory,
  PetWarningSeverity,
  AiSeverity,
  AiFindingKind,
  AiStatus,
  AnalyticsPeriod,
  ClinicRole,
} from '@/types/doctor.phase3';

// ─── Pet species & breeds ────────────────────────────────────────────────────

export const PET_SPECIES_OPTIONS: { value: PetSpecies; label: string }[] = [
  { value: 'dog',       label: 'Dog' },
  { value: 'cat',       label: 'Cat' },
  { value: 'bird',      label: 'Bird' },
  { value: 'rabbit',    label: 'Rabbit' },
  { value: 'reptile',   label: 'Reptile' },
  { value: 'rodent',    label: 'Rodent' },
  { value: 'livestock', label: 'Livestock' },
  { value: 'other',     label: 'Other' },
];

export const PET_SPECIES_LABELS: Record<PetSpecies, string> = {
  dog: 'Dog', cat: 'Cat', bird: 'Bird', rabbit: 'Rabbit',
  reptile: 'Reptile', rodent: 'Rodent', livestock: 'Livestock', other: 'Other',
};

// Common breeds per species (Nigeria-typical sampling) for the breed picker.
export const PET_BREED_OPTIONS: Record<PetSpecies, string[]> = {
  dog:       ['Boerboel', 'German Shepherd', 'Rottweiler', 'Caucasian Shepherd', 'Local (Mongrel)', 'Lhasa Apso'],
  cat:       ['Domestic Shorthair', 'Persian', 'Siamese', 'Maine Coon', 'Local'],
  bird:      ['African Grey', 'Lovebird', 'Canary', 'Budgerigar', 'Parakeet'],
  rabbit:    ['New Zealand White', 'Dutch', 'Lop', 'Local'],
  reptile:   ['Red-eared Slider', 'Ball Python', 'Tortoise'],
  rodent:    ['Hamster', 'Guinea Pig', 'Rat', 'Gerbil'],
  livestock: ['Goat', 'Sheep', 'Cattle', 'Poultry'],
  other:     ['Unspecified'],
};

// ─── Pet drug catalogue (weight-based dosing) ────────────────────────────────

export const PET_DRUG_CATEGORY_LABELS: Record<PetDrugCategory, string> = {
  antibiotic:     'Antibiotic',
  antiparasitic:  'Antiparasitic',
  nsaid:          'NSAID',
  analgesic:      'Analgesic',
  vaccine:        'Vaccine',
  supplement:     'Supplement',
  dermatological: 'Dermatological',
  other:          'Other',
};

export const PET_DRUG_CATALOGUE: PetDrug[] = [
  { id: 'pd-amox',   name: 'Amoxicillin (vet)', category: 'antibiotic',    dosePerKgMgLow: 10, dosePerKgMgHigh: 20, defaultFrequency: 'Twice daily',  contraindicatedSpecies: ['rabbit', 'rodent'], warnings: ['Avoid in rabbits/rodents — fatal enterotoxaemia risk.'] },
  { id: 'pd-doxy',   name: 'Doxycycline',       category: 'antibiotic',    dosePerKgMgLow: 5,  dosePerKgMgHigh: 10, defaultFrequency: 'Once daily',   contraindicatedSpecies: [],                   warnings: ['Give with food to reduce GI upset.'] },
  { id: 'pd-carp',   name: 'Carprofen',         category: 'nsaid',         dosePerKgMgLow: 2,  dosePerKgMgHigh: 4,  defaultFrequency: 'Twice daily',  contraindicatedSpecies: ['cat'],              warnings: ['Use with caution in cats — narrow safety margin.', 'Monitor for GI ulceration.'] },
  { id: 'pd-meloxi', name: 'Meloxicam',         category: 'nsaid',         dosePerKgMgLow: 0.1, dosePerKgMgHigh: 0.2, defaultFrequency: 'Once daily', contraindicatedSpecies: [],                  warnings: ['Avoid in dehydration or renal impairment.'] },
  { id: 'pd-tram',   name: 'Tramadol',          category: 'analgesic',     dosePerKgMgLow: 2,  dosePerKgMgHigh: 5,  defaultFrequency: 'Twice daily',  contraindicatedSpecies: [],                   warnings: ['May cause sedation.'] },
  { id: 'pd-praz',   name: 'Praziquantel',      category: 'antiparasitic', dosePerKgMgLow: 5,  dosePerKgMgHigh: 5,  defaultFrequency: 'Single dose',  contraindicatedSpecies: [],                   warnings: ['Single-dose dewormer.'] },
  { id: 'pd-gluco',  name: 'Glucosamine',       category: 'supplement',    dosePerKgMgLow: 8,  dosePerKgMgHigh: 10, defaultFrequency: 'Once daily',   contraindicatedSpecies: [],                   warnings: [] },
];

// ─── Pet lab tests ───────────────────────────────────────────────────────────

export const PET_LAB_CATEGORY_LABELS: Record<string, string> = {
  blood:   'Blood',
  stool:   'Stool',
  urine:   'Urine',
  imaging: 'Imaging',
  skin:    'Skin',
  other:   'Other',
};

export const PET_LAB_TESTS: PetLabTest[] = [
  { id: 'plt-cbc',   name: 'Complete Blood Count', code: 'CBC',  category: 'blood' },
  { id: 'plt-chem',  name: 'Biochemistry Panel',   code: 'CHEM', category: 'blood' },
  { id: 'plt-hw',    name: 'Heartworm Antigen',    code: 'HW',   category: 'blood' },
  { id: 'plt-stool', name: 'Faecal Float (Ova & Parasites)', code: 'FEC', category: 'stool' },
  { id: 'plt-urin',  name: 'Urinalysis',           code: 'UA',   category: 'urine' },
  { id: 'plt-xray',  name: 'Radiograph',           code: 'XR',   category: 'imaging' },
  { id: 'plt-us',    name: 'Abdominal Ultrasound', code: 'US',   category: 'imaging' },
  { id: 'plt-skin',  name: 'Skin Scrape (Cytology)', code: 'SKN', category: 'skin' },
];

// ─── Pet store product categories ────────────────────────────────────────────

export const PET_PRODUCT_CATEGORIES: { value: PetProductCategory; label: string }[] = [
  { value: 'food',       label: 'Food' },
  { value: 'supplement', label: 'Supplement' },
  { value: 'grooming',   label: 'Grooming' },
  { value: 'medicine',   label: 'Medicine' },
  { value: 'accessory',  label: 'Accessory' },
];

// ─── Pet prescription warning tones ──────────────────────────────────────────

export const PET_WARNING_SEVERITY_LABELS: Record<PetWarningSeverity, string> = {
  info:    'Info',
  caution: 'Caution',
  danger:  'Danger',
};

export const PET_WARNING_SEVERITY_TONES: Record<PetWarningSeverity, string> = {
  info:    '#3B82F6',
  caution: '#F59E0B',
  danger:  '#EF4444',
};

// ─── AI — status, severity & finding-kind labels/tones ───────────────────────

export const AI_STATUS_LABELS: Record<AiStatus, string> = {
  idle:       'Not generated',
  generating: 'Generating…',
  ready:      'Ready',
  error:      'Failed',
};

export const AI_SEVERITY_LABELS: Record<AiSeverity, string> = {
  low:      'Low',
  moderate: 'Moderate',
  high:     'High',
  critical: 'Critical',
};

// Tones for severity chips/badges (hex; UI may map to its own palette).
export const AI_SEVERITY_TONES: Record<AiSeverity, string> = {
  low:      '#10B981',
  moderate: '#F59E0B',
  high:     '#F97316',
  critical: '#EF4444',
};

// Rank order so the UI can sort findings worst-first.
export const AI_SEVERITY_RANK: Record<AiSeverity, number> = {
  low: 0, moderate: 1, high: 2, critical: 3,
};

export const AI_FINDING_KIND_LABELS: Record<AiFindingKind, string> = {
  interaction:      'Drug interaction',
  contraindication: 'Contraindication',
  dosage:           'Dosage',
  duplication:      'Duplication',
  allergy:          'Allergy',
};

// ─── Analytics periods ───────────────────────────────────────────────────────

export const ANALYTICS_PERIOD_OPTIONS: { value: AnalyticsPeriod; label: string }[] = [
  { value: '7d',  label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '12m', label: 'Last 12 months' },
];

// ─── Clinic roles ────────────────────────────────────────────────────────────

export const CLINIC_ROLE_OPTIONS: { value: ClinicRole; label: string }[] = [
  { value: 'owner',      label: 'Owner' },
  { value: 'lead',       label: 'Lead clinician' },
  { value: 'consultant', label: 'Consultant' },
  { value: 'locum',      label: 'Locum' },
  { value: 'volunteer',  label: 'Volunteer' },
];

export const CLINIC_ROLE_LABELS: Record<ClinicRole, string> = {
  owner:      'Owner',
  lead:       'Lead clinician',
  consultant: 'Consultant',
  locum:      'Locum',
  volunteer:  'Volunteer',
};
