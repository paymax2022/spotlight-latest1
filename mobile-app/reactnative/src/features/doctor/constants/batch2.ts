// ── Doctor module — Batch 2 (sections G · H · I · J) constants ────────────────
// Static option lists for the Batch 2 provider-side screens. Pure data only —
// no money math. Money is always integers in kobo. ADDITIVE to
// `@/features/doctor/constants` (re-exported from its barrel). REUSES
// DIAGNOSIS_OPTIONS / DRUG_CATALOGUE / SUPPORT_CATEGORIES from the barrel —
// do not duplicate those here.

import type { DiagnosisCode } from '@/types/doctor.batch2';
import type {
  ChatMessageKind,
  ChatDeliveryStatus,
  PresenceStatus,
  CallProvider,
  NetworkQuality,
  PatientType,
  PatientDocumentKind,
} from '@/types/doctor.batch2';

// ═══════════════════════════════════════════════════════════════════════════
// SECTION G — patient profile review
// ═══════════════════════════════════════════════════════════════════════════

// Patient-type labels (drives the adult/child/elderly demographic badge).
export const PATIENT_TYPE_LABELS: Record<PatientType, string> = {
  adult:   'Adult',
  child:   'Child',
  elderly: 'Elderly',
};

// Relationship options (emergency contact, dependents, family history).
export const RELATIONSHIP_OPTIONS: string[] = [
  'Spouse',
  'Parent',
  'Father',
  'Mother',
  'Sibling',
  'Child',
  'Son',
  'Daughter',
  'Guardian',
  'Ward',
  'Grandparent',
  'Friend',
  'Other',
];

// Symptom options for the submitted-symptoms / intake list (ICD-lite agnostic).
export const SYMPTOM_OPTIONS: string[] = [
  'Headache',
  'Fever',
  'Cough',
  'Fatigue',
  'Dizziness',
  'Chest pain',
  'Shortness of breath',
  'Abdominal pain',
  'Nausea',
  'Vomiting',
  'Diarrhoea',
  'Rash',
  'Joint pain',
  'Back pain',
  'Sore throat',
  'Loss of appetite',
];

export const SYMPTOM_SEVERITY_OPTIONS: { value: 'mild' | 'moderate' | 'severe'; label: string }[] = [
  { value: 'mild',     label: 'Mild' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe',   label: 'Severe' },
];

// Allergy type options.
export const ALLERGY_TYPE_OPTIONS: { value: 'drug' | 'food' | 'environmental' | 'other'; label: string }[] = [
  { value: 'drug',          label: 'Drug' },
  { value: 'food',          label: 'Food' },
  { value: 'environmental', label: 'Environmental' },
  { value: 'other',         label: 'Other' },
];

// Patient document kind labels (uploaded-documents list).
export const PATIENT_DOCUMENT_KIND_LABELS: Record<PatientDocumentKind, string> = {
  lab_report:        'Lab Report',
  imaging:           'Imaging',
  discharge_summary: 'Discharge Summary',
  referral_letter:   'Referral Letter',
  prescription:      'Prescription',
  other:             'Other Document',
};

// Clinical-alert severity tones (shared by risk / drug-allergy / contraindication).
export const CLINICAL_ALERT_TONES: Record<'info' | 'warning' | 'critical', { label: string; tone: string }> = {
  info:     { label: 'Info',     tone: 'info' },
  warning:  { label: 'Caution',  tone: 'warning' },
  critical: { label: 'Critical', tone: 'danger' },
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTION H — chat consultation
// ═══════════════════════════════════════════════════════════════════════════

// Chat message kind labels (drives the bubble header / placeholder copy).
export const MESSAGE_KIND_LABELS: Record<ChatMessageKind, string> = {
  text:                'Message',
  voice:               'Voice note',
  image:               'Image',
  document:            'Document',
  shared_prescription: 'Prescription',
  shared_lab:          'Lab order',
  shared_summary:      'Consultation summary',
  system:              'System',
};

// Delivery-status labels (read-receipt tick states).
export const DELIVERY_STATUS_LABELS: Record<ChatDeliveryStatus, string> = {
  sending:   'Sending…',
  sent:      'Sent',
  delivered: 'Delivered',
  read:      'Read',
  failed:    'Failed',
};

// Presence labels (typing / online / offline state copy).
export const CHAT_PRESENCE_LABELS: Record<PresenceStatus, string> = {
  online:  'Online',
  offline: 'Offline',
  typing:  'Typing…',
};

// Reasons for reporting an abusive / inappropriate chat message.
export const REPORT_REASONS: string[] = [
  'Abusive or threatening language',
  'Harassment',
  'Spam or advertising',
  'Sharing inappropriate content',
  'Requesting off-platform payment',
  'Other',
];

// Secure-chat notice copy (single source of truth for the encryption banner).
export const SECURE_CHAT_NOTICE =
  'Messages are end-to-end encrypted. Do not share login credentials, OTPs or off-platform payment details in chat.';

// ═══════════════════════════════════════════════════════════════════════════
// SECTION I — audio & video consultation
// ═══════════════════════════════════════════════════════════════════════════

// Real-time provider labels (Agora primary, VideoSDK fallback).
export const CALL_PROVIDER_LABELS: Record<CallProvider, string> = {
  agora:    'Agora',
  videosdk: 'VideoSDK',
};

// Network-quality labels + tone keys (drives the quality pill + warnings).
export const NETWORK_QUALITY_LABELS: Record<NetworkQuality, { label: string; tone: string }> = {
  excellent: { label: 'Excellent', tone: 'success' },
  good:      { label: 'Good',      tone: 'success' },
  fair:      { label: 'Fair',      tone: 'warning' },
  poor:      { label: 'Poor',      tone: 'danger' },
  unknown:   { label: 'Unknown',   tone: 'muted' },
};

// Call-quality feedback rating labels (1–5 stars).
export const CALL_FEEDBACK_RATING_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'Very poor',
  2: 'Poor',
  3: 'Okay',
  4: 'Good',
  5: 'Excellent',
};

// Technical-issue categories (report-technical-issue picker).
export const TECHNICAL_ISSUE_CATEGORIES: string[] = [
  'Audio',
  'Video',
  'Connection / dropped call',
  'Could not join',
  'Echo / feedback',
  'App crashed',
  'Other',
];

// Reasons attached to a failed-call dispute.
export const CALL_DISPUTE_REASONS: string[] = [
  'Call never connected',
  'Call dropped and could not reconnect',
  'Patient did not join',
  'Poor quality made the consult impossible',
  'Charged for a call that did not happen',
  'Other',
];

// ═══════════════════════════════════════════════════════════════════════════
// SECTION J — consultation notes & diagnosis
// ═══════════════════════════════════════════════════════════════════════════

// Searchable ICD-lite diagnosis catalogue (drives diagnosis search + code
// selection). Superset of the barrel's DIAGNOSIS_OPTIONS with a category field
// for grouping/filtering. DIAGNOSIS_OPTIONS (code+label) is reused elsewhere;
// this richer catalogue is Section J's source of truth.
export const ICD_CODES: DiagnosisCode[] = [
  { code: 'I10',   label: 'Essential Hypertension',                  category: 'Cardiovascular' },
  { code: 'I25',   label: 'Chronic Ischaemic Heart Disease',         category: 'Cardiovascular' },
  { code: 'E11',   label: 'Type 2 Diabetes Mellitus',                category: 'Endocrine' },
  { code: 'E78',   label: 'Hyperlipidaemia',                         category: 'Endocrine' },
  { code: 'E03',   label: 'Hypothyroidism',                          category: 'Endocrine' },
  { code: 'J06',   label: 'Acute Upper Respiratory Infection',       category: 'Respiratory' },
  { code: 'J45',   label: 'Asthma',                                  category: 'Respiratory' },
  { code: 'J18',   label: 'Pneumonia',                               category: 'Respiratory' },
  { code: 'B54',   label: 'Malaria (unspecified)',                   category: 'Infectious' },
  { code: 'A09',   label: 'Gastroenteritis',                         category: 'Gastrointestinal' },
  { code: 'K21',   label: 'Gastro-oesophageal Reflux Disease',       category: 'Gastrointestinal' },
  { code: 'K29',   label: 'Gastritis',                               category: 'Gastrointestinal' },
  { code: 'L23',   label: 'Contact Dermatitis',                      category: 'Dermatological' },
  { code: 'L20',   label: 'Atopic Dermatitis (Eczema)',              category: 'Dermatological' },
  { code: 'F41',   label: 'Anxiety Disorder',                        category: 'Mental Health' },
  { code: 'F32',   label: 'Depressive Episode',                      category: 'Mental Health' },
  { code: 'M54',   label: 'Back Pain',                               category: 'Musculoskeletal' },
  { code: 'M25',   label: 'Joint Pain',                              category: 'Musculoskeletal' },
  { code: 'N39',   label: 'Urinary Tract Infection',                 category: 'Genitourinary' },
  { code: 'R51',   label: 'Headache',                                category: 'Symptoms' },
  { code: 'R50',   label: 'Fever (unspecified)',                     category: 'Symptoms' },
  { code: 'R05',   label: 'Cough',                                   category: 'Symptoms' },
  { code: 'D50',   label: 'Iron-deficiency Anaemia',                 category: 'Haematology' },
  { code: 'O26',   label: 'Pregnancy-related Condition',             category: 'Obstetric' },
];

// Diagnosis-category options (for grouping / filtering the ICD picker).
export const DIAGNOSIS_CATEGORIES: string[] = [
  'Cardiovascular',
  'Endocrine',
  'Respiratory',
  'Infectious',
  'Gastrointestinal',
  'Dermatological',
  'Mental Health',
  'Musculoskeletal',
  'Genitourinary',
  'Symptoms',
  'Haematology',
  'Obstetric',
];

// Common red-flag warnings (emergency / urgent escalation cues for the note).
export const RED_FLAG_OPTIONS: { label: string; action: string; severity: 'warning' | 'critical' }[] = [
  { label: 'Chest pain with radiation to arm/jaw', action: 'Refer to emergency department immediately', severity: 'critical' },
  { label: 'Sudden severe (thunderclap) headache', action: 'Urgent neuro-imaging / emergency referral',  severity: 'critical' },
  { label: 'Difficulty breathing / cyanosis',      action: 'Emergency referral',                         severity: 'critical' },
  { label: 'Altered consciousness',                action: 'Emergency referral',                         severity: 'critical' },
  { label: 'Uncontrolled bleeding',               action: 'Emergency referral',                         severity: 'critical' },
  { label: 'BP > 180/120 mmHg',                   action: 'Assess for hypertensive emergency',          severity: 'warning'  },
  { label: 'Persistent high fever > 39.5 °C',     action: 'Investigate source; consider admission',     severity: 'warning'  },
  { label: 'Severe dehydration',                  action: 'Consider IV fluids / referral',              severity: 'warning'  },
];

// Lifestyle recommendation categories.
export const LIFESTYLE_CATEGORIES: string[] = [
  'Diet',
  'Exercise',
  'Smoking',
  'Alcohol',
  'Sleep',
  'Stress',
  'Hydration',
  'Medication adherence',
];

// Follow-up interval presets (days) for the note's follow-up recommendation.
export const FOLLOW_UP_INTERVAL_OPTIONS: { days: number; label: string }[] = [
  { days: 3,  label: 'In 3 days' },
  { days: 7,  label: 'In 1 week' },
  { days: 14, label: 'In 2 weeks' },
  { days: 30, label: 'In 1 month' },
  { days: 90, label: 'In 3 months' },
];

// Clinical-note status labels (draft / finalized / locked).
export const CLINICAL_NOTE_STATUS_LABELS: Record<'draft' | 'finalized' | 'locked', string> = {
  draft:     'Draft',
  finalized: 'Finalized',
  locked:    'Locked',
};
