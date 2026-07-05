// ── Paymax Health — Mock dataset (Phase 0) ───────────────────────────────────
// Self-contained mock backing for the shared health platform: records for a
// patient + a pet, consent grants, intake schemas + responses, a provider, a
// consult. Money in kobo. Used while USE_MOCK is true.

import type {
  HealthRecord,
  RecordSubject,
  ConsentGrant,
  IntakeSchema,
  IntakeResponse,
  HealthProvider,
  Consult,
  ActiveOrderSummary,
} from '../types';

const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
const daysAhead = (d: number) => new Date(now + d * 86_400_000).toISOString();

// ── Subjects: the patient (consumer identity) + one pet ──────────────────────
export const MOCK_SUBJECTS: RecordSubject[] = [
  { id: 'subj_self', type: 'patient', name: 'Adaeze Okafor', detail: 'DOB 14 Mar 1991 · 34 yrs', avatarColor: 'iconBgPurple' },
  { id: 'subj_pet1', type: 'pet', name: 'Milo', detail: 'Dog · Boerboel · 3 yrs', avatarColor: 'iconBgTeal' },
];

// ── Records (patient + pet) ──────────────────────────────────────────────────
export const MOCK_RECORDS: HealthRecord[] = [
  {
    id: 'rec_001',
    subjectId: 'subj_self',
    subjectName: 'Adaeze Okafor',
    subjectType: 'patient',
    kind: 'lab_result',
    title: 'Full Blood Count (FBC)',
    summary: 'All values within reference range.',
    source: 'lab',
    providerId: 'prov_lab1',
    providerName: 'Synlab Diagnostics, Lekki',
    issuedAt: daysAgo(4),
    flagged: false,
    docs: [{ id: 'doc_001', label: 'FBC report.pdf', mimeType: 'application/pdf' }],
    fields: [
      { label: 'Haemoglobin', value: '13.2 g/dL (12–16)' },
      { label: 'WBC', value: '6.4 ×10⁹/L (4–11)' },
      { label: 'Platelets', value: '250 ×10⁹/L (150–400)' },
    ],
  },
  {
    id: 'rec_002',
    subjectId: 'subj_self',
    subjectName: 'Adaeze Okafor',
    subjectType: 'patient',
    kind: 'lab_result',
    title: 'Lipid Profile',
    summary: 'LDL cholesterol elevated — clinician follow-up advised.',
    source: 'lab',
    providerId: 'prov_lab1',
    providerName: 'Synlab Diagnostics, Lekki',
    issuedAt: daysAgo(6),
    flagged: true,
    docs: [{ id: 'doc_002', label: 'Lipid profile.pdf', mimeType: 'application/pdf' }],
    fields: [
      { label: 'Total cholesterol', value: '5.9 mmol/L (<5.2)' },
      { label: 'LDL', value: '3.8 mmol/L (<3.0)' },
      { label: 'HDL', value: '1.3 mmol/L (>1.0)' },
    ],
  },
  {
    id: 'rec_003',
    subjectId: 'subj_self',
    subjectName: 'Adaeze Okafor',
    subjectType: 'patient',
    kind: 'prescription',
    title: 'Amlodipine 5mg',
    summary: 'Once daily for 30 days. POM — pharmacist verification required.',
    source: 'pharmacy',
    providerId: 'prov_pharm1',
    providerName: 'HealthPlus Pharmacy',
    issuedAt: daysAgo(3),
    docs: [{ id: 'doc_003', label: 'e-Prescription.pdf', mimeType: 'application/pdf' }],
    fields: [
      { label: 'Dosage', value: '5mg once daily' },
      { label: 'Duration', value: '30 days' },
      { label: 'Status', value: 'Verified · dispensed once' },
    ],
  },
  {
    id: 'rec_004',
    subjectId: 'subj_pet1',
    subjectName: 'Milo',
    subjectType: 'pet',
    kind: 'consult_note',
    title: 'Routine wellness check',
    summary: 'Healthy. Recommended annual booster and dental scaling.',
    source: 'vet',
    providerId: 'prov_vet1',
    providerName: 'Dr. Bisi Adeyemi (VetCare)',
    issuedAt: daysAgo(10),
    docs: [],
    fields: [
      { label: 'Weight', value: '54 kg' },
      { label: 'Temperature', value: '38.6 °C' },
      { label: 'Plan', value: 'Annual booster due in 2 weeks' },
    ],
  },
  {
    id: 'rec_005',
    subjectId: 'subj_pet1',
    subjectName: 'Milo',
    subjectType: 'pet',
    kind: 'vaccination',
    title: 'Rabies vaccination',
    summary: 'Administered. Next dose due in 12 months.',
    source: 'vet',
    providerId: 'prov_vet1',
    providerName: 'Dr. Bisi Adeyemi (VetCare)',
    issuedAt: daysAgo(40),
    docs: [{ id: 'doc_005', label: 'Vaccination card.pdf', mimeType: 'application/pdf' }],
    fields: [
      { label: 'Vaccine', value: 'Nobivac Rabies' },
      { label: 'Next due', value: daysAhead(325).slice(0, 10) },
    ],
  },
];

// ── Consent grants (cross-vertical sharing) ──────────────────────────────────
export const MOCK_CONSENTS: ConsentGrant[] = [
  {
    id: 'con_001',
    subjectId: 'subj_self',
    subjectName: 'Adaeze Okafor',
    granteeId: 'prov_pharm1',
    granteeName: 'HealthPlus Pharmacy',
    granteeVertical: 'pharmacy',
    scopes: ['prescription'],
    status: 'active',
    grantedAt: daysAgo(3),
    lastAccessedAt: daysAgo(3),
  },
  {
    id: 'con_002',
    subjectId: 'subj_self',
    subjectName: 'Adaeze Okafor',
    granteeId: 'prov_lab1',
    granteeName: 'Synlab Diagnostics, Lekki',
    granteeVertical: 'lab',
    scopes: ['lab_result', 'consult_note'],
    status: 'active',
    grantedAt: daysAgo(6),
    expiresAt: daysAhead(84),
    lastAccessedAt: daysAgo(5),
  },
  {
    id: 'con_003',
    subjectId: 'subj_pet1',
    subjectName: 'Milo',
    granteeId: 'prov_vet1',
    granteeName: 'Dr. Bisi Adeyemi (VetCare)',
    granteeVertical: 'vet',
    scopes: ['all'],
    status: 'revoked',
    grantedAt: daysAgo(50),
    lastAccessedAt: daysAgo(40),
  },
];

// ── Providers (eligible grantees for new shares + provider profile) ──────────
export const MOCK_PROVIDERS: HealthProvider[] = [
  {
    id: 'prov_vet1',
    name: 'Dr. Bisi Adeyemi',
    vertical: 'vet',
    headline: 'Veterinary Surgeon · VetCare Clinic',
    bio: 'Small-animal vet with 9 years of practice across companion-animal medicine, preventive care and tele-triage. Special interest in canine dermatology.',
    credential: { authority: 'VCN', licenseNo: 'VCN/2016/04821', status: 'verified', expiresAt: daysAhead(220) },
    rating: 4.9,
    reviewCount: 218,
    location: 'Lekki Phase 1, Lagos',
    baseFeeKobo: 750_000,
    specialties: ['Companion animals', 'Dermatology', 'Preventive care'],
    active: true,
  },
  {
    id: 'prov_pharm1',
    name: 'HealthPlus Pharmacy',
    vertical: 'pharmacy',
    headline: 'Community Pharmacy · PCN registered',
    bio: 'Full-service community pharmacy offering POM dispensing with pharmacist verification, OTC and chronic-care refills.',
    credential: { authority: 'PCN', licenseNo: 'PCN/PR/2019/3310', status: 'verified', expiresAt: daysAhead(120) },
    rating: 4.7,
    reviewCount: 540,
    location: 'Victoria Island, Lagos',
    baseFeeKobo: 200_000,
    specialties: ['POM dispensing', 'Chronic care', 'Pharmacist consult'],
    active: true,
  },
  {
    id: 'prov_lab1',
    name: 'Synlab Diagnostics',
    vertical: 'lab',
    headline: 'Diagnostic Laboratory · MLSCN accredited',
    bio: 'Accredited diagnostic laboratory offering home sample collection, full chemistry, haematology and imaging referrals.',
    credential: { authority: 'MLSCN', licenseNo: 'MLSCN/LAB/2018/0992', status: 'verified', expiresAt: daysAhead(60) },
    rating: 4.8,
    reviewCount: 309,
    location: 'Lekki, Lagos',
    baseFeeKobo: 500_000,
    specialties: ['Home collection', 'Chemistry', 'Haematology'],
    active: true,
  },
];

// ── Intake schemas (versioned, schema-driven) ────────────────────────────────
export const MOCK_INTAKE_SCHEMAS: IntakeSchema[] = [
  {
    id: 'vet_triage_v2',
    version: 2,
    title: 'Pet triage intake',
    description: 'Help the vet prepare for your consult. This takes about 2 minutes.',
    vertical: 'vet',
    sections: [
      {
        id: 'sec_pet',
        title: 'About your pet',
        fields: [
          { id: 'pet_name', type: 'short_text', label: "Pet's name", required: true, placeholder: 'e.g. Milo' },
          {
            id: 'species',
            type: 'single_select',
            label: 'Species',
            required: true,
            options: [
              { value: 'dog', label: 'Dog' },
              { value: 'cat', label: 'Cat' },
              { value: 'other', label: 'Other' },
            ],
          },
          { id: 'age_years', type: 'number', label: 'Age (years)', required: true, min: 0, max: 40 },
        ],
      },
      {
        id: 'sec_symptoms',
        title: 'Symptoms',
        description: 'Tell us what you have noticed.',
        fields: [
          {
            id: 'symptoms',
            type: 'multi_select',
            label: 'What have you observed?',
            required: true,
            options: [
              { value: 'appetite', label: 'Loss of appetite' },
              { value: 'lethargy', label: 'Lethargy' },
              { value: 'vomiting', label: 'Vomiting' },
              { value: 'skin', label: 'Skin / coat issue' },
              { value: 'limping', label: 'Limping' },
            ],
          },
          { id: 'onset', type: 'date', label: 'When did it start?', help: 'Approximate date is fine.' },
          { id: 'notes', type: 'long_text', label: 'Anything else?', placeholder: 'Describe in your own words…' },
          { id: 'emergency', type: 'boolean', label: 'Is your pet in visible distress right now?' },
        ],
      },
    ],
  },
  {
    id: 'lab_fasting_prep_v1',
    version: 1,
    title: 'Lab test preparation',
    description: 'Confirm your preparation so results are accurate.',
    vertical: 'lab',
    sections: [
      {
        id: 'sec_prep',
        title: 'Preparation',
        fields: [
          { id: 'fasted', type: 'boolean', label: 'Have you fasted for at least 8 hours?', required: true },
          {
            id: 'meds',
            type: 'multi_select',
            label: 'Medications taken in the last 24h',
            options: [
              { value: 'none', label: 'None' },
              { value: 'bp', label: 'Blood-pressure meds' },
              { value: 'supplements', label: 'Supplements / vitamins' },
            ],
          },
          { id: 'last_meal', type: 'short_text', label: 'When was your last meal?', placeholder: 'e.g. 9pm last night' },
        ],
      },
    ],
  },
];

export const MOCK_INTAKE_RESPONSES: IntakeResponse[] = [
  {
    schemaId: 'vet_triage_v2',
    schemaVersion: 2,
    subjectId: 'subj_pet1',
    values: { pet_name: 'Milo', species: 'dog', age_years: 3, symptoms: ['skin'] },
    submittedAt: daysAgo(11),
  },
];

// ── Consult (tele-consult lobby + room) ──────────────────────────────────────
export const MOCK_CONSULTS: Consult[] = [
  {
    id: 'cns_001',
    vertical: 'vet',
    providerId: 'prov_vet1',
    providerName: 'Dr. Bisi Adeyemi',
    subjectId: 'subj_pet1',
    subjectName: 'Milo',
    mode: 'video',
    status: 'scheduled',
    scheduledAt: new Date(now + 6 * 60_000).toISOString(),
    providerReady: true,
    messages: [
      {
        id: 'msg_001',
        authorId: 'prov_vet1',
        authorName: 'Dr. Bisi Adeyemi',
        fromProvider: true,
        body: "Hi! I've reviewed Milo's triage intake. I'll join the call shortly — please have him nearby.",
        sentAt: new Date(now - 4 * 60_000).toISOString(),
      },
    ],
  },
];

// ── Active care-loop items for the hub summary ───────────────────────────────
export const MOCK_ACTIVE_ORDERS: ActiveOrderSummary[] = [
  {
    id: 'ord_pharm_1',
    vertical: 'pharmacy',
    title: 'Amlodipine 5mg ×1',
    statusLabel: 'Out for delivery',
    href: '/health/pharmacy',
  },
  {
    id: 'ord_lab_1',
    vertical: 'lab',
    title: 'Lipid Profile retest',
    statusLabel: 'Sample collected',
    href: '/health/lab',
  },
];
