// ── Paymax Health — Pre-Consult Intake mock dataset ──────────────────────────
// Self-contained mock backing for the patient Pre-Consultation Health Intake
// wizard (M1–M17). Mirrors the conventions in health.mock.ts. Used while
// USE_MOCK is true so the wizard runs fully offline — no backend required.

import type {
  PreConsultIntakeSchema,
  PreConsultIntake,
  HealthProfile,
  IntakeResponseValues,
  RedFlagResult,
} from '../types';
import { formatMedList } from '../utils';

const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

export const CONSENT_VERSION = '2026-01';

export const CONSENT_BODY =
  'Your intake answers are shared with the doctor assigned to this appointment to ' +
  'provide your care. They are sensitive health data under the NDPA 2023 — encrypted, ' +
  'access-logged, and visible only within this care relationship. Every doctor access ' +
  'is recorded. You can review or update your details any time before the consult starts.';

// ── Clinical vocabularies (would come from Admin A3 in production) ─────────────
export const ALLERGEN_OPTIONS = [
  { value: 'penicillin', label: 'Penicillin' },
  { value: 'sulfa', label: 'Sulfa drugs' },
  { value: 'nsaids', label: 'NSAIDs (ibuprofen, aspirin)' },
  { value: 'peanuts', label: 'Peanuts' },
  { value: 'shellfish', label: 'Shellfish' },
  { value: 'eggs', label: 'Eggs' },
  { value: 'latex', label: 'Latex' },
  { value: 'other', label: 'Other (note below)' },
];

export const CHRONIC_CONDITION_OPTIONS = [
  { value: 'diabetes', label: 'Diabetes' },
  { value: 'hypertension', label: 'Hypertension' },
  { value: 'asthma', label: 'Asthma' },
  { value: 'heart_disease', label: 'Heart disease' },
  { value: 'kidney_disease', label: 'Kidney disease' },
  { value: 'thyroid', label: 'Thyroid disorder' },
  { value: 'epilepsy', label: 'Epilepsy / seizures' },
  { value: 'other', label: 'Other (note below)' },
];

// ── The Pre-Consult intake schema (conditional steps, M4–M12) ─────────────────
export const PRECONSULT_SCHEMA: PreConsultIntakeSchema = {
  id: 'preconsult_v1',
  version: 1,
  title: 'Pre-consultation intake',
  description: 'A few questions so your doctor walks in informed. About 3 minutes.',
  consentVersion: CONSENT_VERSION,
  consentBody: CONSENT_BODY,
  steps: [
    {
      id: 'reason',
      prdScreen: 'M4',
      title: 'Reason for visit',
      description: 'What would you like help with today?',
      fields: [
        {
          id: 'chief_complaint',
          type: 'long_text',
          label: 'Describe your main concern',
          placeholder: 'In your own words…',
          required: true,
          patientReported: true,
        },
        {
          id: 'complaint_category',
          type: 'single_select',
          label: 'Category (optional)',
          options: [
            { value: 'general', label: 'General / feeling unwell' },
            { value: 'pain', label: 'Pain' },
            { value: 'respiratory', label: 'Cough / breathing' },
            { value: 'skin', label: 'Skin' },
            { value: 'mental_health', label: 'Mental health' },
            { value: 'follow_up', label: 'Follow-up' },
          ],
        },
        {
          id: 'is_symptomatic',
          type: 'boolean',
          label: 'Are you currently experiencing symptoms?',
          required: true,
        },
      ],
    },
    {
      id: 'symptom_detail',
      prdScreen: 'M5',
      title: 'Symptom detail',
      description: 'Tell us a bit more so the doctor can prepare.',
      when: { fieldId: 'is_symptomatic', truthy: true },
      fields: [
        { id: 'onset', type: 'date', label: 'When did it start?', help: 'Approximate date is fine.' },
        {
          id: 'severity',
          type: 'scale',
          label: 'How severe is it right now?',
          help: '1 = very mild, 10 = worst imaginable',
          min: 1,
          max: 10,
          required: true,
          patientReported: true,
        },
        { id: 'better_with', type: 'short_text', label: 'What makes it better?', placeholder: 'e.g. rest, paracetamol' },
        { id: 'worse_with', type: 'short_text', label: 'What makes it worse?', placeholder: 'e.g. movement, eating' },
        {
          id: 'red_flag_symptoms',
          type: 'multi_select',
          label: 'Do you have any of these right now?',
          help: 'Select any that apply — this helps us get you the right help fast.',
          patientReported: true,
          noneValue: 'none',
          options: [
            { value: 'none', label: 'None of these' },
            { value: 'chest_pain', label: 'Chest pain / pressure' },
            { value: 'breathing', label: 'Severe difficulty breathing' },
            { value: 'stroke', label: 'Face drooping / slurred speech / weakness one side' },
            { value: 'bleeding', label: 'Severe / uncontrolled bleeding' },
            { value: 'self_harm', label: 'Thoughts of harming myself' },
          ],
        },
      ],
    },
    {
      id: 'medications',
      prdScreen: 'M6',
      title: 'Current medications',
      description: 'Safety-critical — your doctor checks this before prescribing.',
      fields: [
        {
          id: 'meds_none',
          type: 'boolean',
          label: 'Are you currently taking any medications?',
          required: true,
        },
        {
          id: 'medications_list',
          type: 'med_list',
          label: 'List your medications and doses',
          help: 'Add each medicine with its dose, then tap “Add another” for more.',
          patientReported: true,
        },
      ],
    },
    {
      id: 'allergies',
      prdScreen: 'M7',
      title: 'Allergies',
      description: 'Safety-critical — surfaced to your doctor and any prescription.',
      fields: [
        {
          id: 'allergies_none',
          type: 'boolean',
          label: 'Do you have any drug or food allergies?',
          required: true,
        },
        {
          id: 'allergies_list',
          type: 'multi_select',
          label: 'Select your allergies',
          help: 'Choose all that apply.',
          patientReported: true,
          options: ALLERGEN_OPTIONS,
        },
        {
          id: 'allergies_other',
          type: 'short_text',
          label: 'Other allergy / reaction details',
          placeholder: 'e.g. rash with codeine',
        },
      ],
    },
    {
      id: 'chronic',
      prdScreen: 'M8',
      title: 'Chronic conditions',
      description: 'Conditions you live with day to day.',
      fields: [
        {
          id: 'conditions_none',
          type: 'boolean',
          label: 'Do you have any ongoing / chronic conditions?',
          required: true,
        },
        {
          id: 'conditions_list',
          type: 'multi_select',
          label: 'Select your conditions',
          patientReported: true,
          options: CHRONIC_CONDITION_OPTIONS,
        },
        { id: 'conditions_other', type: 'short_text', label: 'Other condition', placeholder: 'Note any other condition' },
        {
          id: 'pregnancy_applicable',
          type: 'boolean',
          label: 'Could you be pregnant, breastfeeding, or trying to conceive?',
          help: 'This affects what can be safely prescribed.',
        },
      ],
    },
    {
      id: 'pregnancy',
      prdScreen: 'M9',
      title: 'Pregnancy / breastfeeding',
      description: 'This affects what can be safely prescribed.',
      // Conditional: only when the patient indicates it may apply.
      when: { fieldId: 'pregnancy_applicable', truthy: true },
      fields: [
        {
          id: 'pregnancy_status',
          type: 'single_select',
          label: 'Current status',
          required: true,
          patientReported: true,
          options: [
            { value: 'pregnant', label: 'Pregnant' },
            { value: 'breastfeeding', label: 'Breastfeeding' },
            { value: 'trying', label: 'Trying to conceive' },
            { value: 'none', label: 'None of these' },
          ],
        },
      ],
    },
    {
      id: 'lifestyle',
      prdScreen: 'M10',
      title: 'Lifestyle',
      description: 'Optional — helps with context.',
      fields: [
        {
          id: 'smoking',
          type: 'single_select',
          label: 'Smoking',
          options: [
            { value: 'never', label: 'Never' },
            { value: 'former', label: 'Former smoker' },
            { value: 'current', label: 'Current smoker' },
          ],
        },
        {
          id: 'alcohol',
          type: 'single_select',
          label: 'Alcohol',
          options: [
            { value: 'none', label: 'None' },
            { value: 'occasional', label: 'Occasional' },
            { value: 'regular', label: 'Regular' },
          ],
        },
      ],
    },
    {
      id: 'vitals',
      prdScreen: 'M11',
      title: 'Self-reported vitals',
      description: 'All optional — only add what you can measure at home. Skip anything you don’t have the tools for.',
      fields: [
        { id: 'temp_c', type: 'number', label: 'Temperature (°C)', min: 30, max: 45, patientReported: true },
        { id: 'bp', type: 'short_text', label: 'Blood pressure', placeholder: 'e.g. 120/80', patientReported: true },
        { id: 'weight_kg', type: 'number', label: 'Weight (kg)', min: 1, max: 400, patientReported: true },
        { id: 'height_cm', type: 'number', label: 'Height (cm)', min: 30, max: 250, patientReported: true },
        { id: 'pulse', type: 'number', label: 'Pulse (bpm)', min: 20, max: 250, patientReported: true },
      ],
    },
    {
      id: 'attachments',
      prdScreen: 'M12',
      title: 'Attachments',
      description: 'Optional — photos, lab results, or prior prescriptions.',
      fields: [
        {
          id: 'attachments_list',
          type: 'attachment',
          label: 'Add photos or documents',
          help: 'e.g. a photo of a rash, a lab report, or a previous prescription.',
          accept: '.jpg,.jpeg,.png,.pdf',
        },
      ],
    },
  ],
};

// Pre-fill from the patient's profile + last intake (§3 — never re-ask).
export const PRECONSULT_PREFILL: IntakeResponseValues = {
  medications_list: 'Amlodipine 5mg once daily',
  meds_none: true,
  conditions_list: ['hypertension'],
  conditions_none: true,
};

// ── In-session intake store, keyed by appointment id ──────────────────────────
const intakeStore: Record<string, PreConsultIntake> = {
  // A seeded SUBMITTED intake demonstrating M16 (edit submitted) on appt "apt-2".
  'apt-2': {
    appointmentId: 'apt-2',
    schemaId: PRECONSULT_SCHEMA.id,
    schemaVersion: PRECONSULT_SCHEMA.version,
    status: 'SUBMITTED',
    answers: {
      chief_complaint: 'Recurring headaches for the last week.',
      complaint_category: 'pain',
      is_symptomatic: true,
      severity: 6,
      meds_none: true,
      medications_list: '[{"name":"Amlodipine","dose":"5mg once daily"}]',
      allergies_none: true,
      allergies_list: ['penicillin'],
      conditions_none: true,
      conditions_list: ['hypertension'],
    },
    consentVersion: CONSENT_VERSION,
    consentAcceptedAt: daysAgo(1),
    updatedAt: daysAgo(1),
    submittedAt: daysAgo(1),
    doctorName: 'Dr. Bisi Adeyemi',
  },
};

export function mockGetIntake(appointmentId: string): PreConsultIntake {
  if (!intakeStore[appointmentId]) {
    intakeStore[appointmentId] = {
      appointmentId,
      schemaId: PRECONSULT_SCHEMA.id,
      schemaVersion: PRECONSULT_SCHEMA.version,
      status: 'DRAFT',
      answers: {},
      doctorName: 'Dr. Bisi Adeyemi',
    };
  }
  return intakeStore[appointmentId];
}

export function mockSaveDraft(appointmentId: string, answers: IntakeResponseValues, consentVersion?: string): PreConsultIntake {
  const current = mockGetIntake(appointmentId);
  const next: PreConsultIntake = {
    ...current,
    answers: { ...current.answers, ...answers },
    consentVersion: consentVersion ?? current.consentVersion,
    consentAcceptedAt: consentVersion && !current.consentAcceptedAt ? new Date().toISOString() : current.consentAcceptedAt,
    updatedAt: new Date().toISOString(),
  };
  intakeStore[appointmentId] = next;
  return next;
}

// Red-flag triage — runs at submit (§5). Pure product-safety routing, no diagnosis.
export function mockEvaluateRedFlag(answers: IntakeResponseValues): RedFlagResult | undefined {
  const flags = Array.isArray(answers.red_flag_symptoms) ? answers.red_flag_symptoms : [];
  if (flags.includes('self_harm')) {
    return {
      severity: 'emergency',
      routing: 'CRISIS',
      guidance: {
        title: 'You deserve support right now',
        body:
          "Thank you for telling us. You don't have to face this alone — support is available and reaching out " +
          'can help. Please consider contacting a mental health professional or a crisis line now. If you might ' +
          'act on thoughts of harming yourself, or are in immediate danger, contact local emergency services.',
        // Admin-configured per locale (health_intake_config.crisis_guidance.crisis_line); blank by default.
        crisis_line: '',
        show_emergency_number: true,
      },
    };
  }
  if (flags.some((f) => ['chest_pain', 'breathing', 'stroke', 'bleeding'].includes(f))) {
    return {
      severity: 'emergency',
      routing: 'EMERGENCY',
      guidance: {
        title: 'These symptoms may need emergency care',
        body:
          'Based on what you reported, please seek in-person emergency care now rather than waiting for a ' +
          'tele-consult. Call emergency services or go to the nearest emergency department.',
        show_emergency_number: true,
      },
    };
  }
  const severity = typeof answers.severity === 'number' ? answers.severity : 0;
  if (severity >= 9) {
    return {
      severity: 'urgent',
      routing: 'URGENT_CARE',
      guidance: {
        title: 'This sounds urgent',
        body:
          'You rated your symptoms as severe. If they are getting worse or you feel unsafe waiting, please ' +
          'consider urgent in-person care. Otherwise your doctor will prioritise your consult.',
      },
    };
  }
  return undefined;
}

export function mockSubmitIntake(appointmentId: string, answers: IntakeResponseValues, consentVersion: string) {
  const saved = mockSaveDraft(appointmentId, answers, consentVersion);
  const red_flag = mockEvaluateRedFlag(answers);
  const submitted: PreConsultIntake = {
    ...saved,
    status: 'SUBMITTED',
    consentVersion,
    submittedAt: new Date().toISOString(),
  };
  intakeStore[appointmentId] = submitted;
  return { status: 'SUBMITTED' as const, red_flag, intake: submitted };
}

// ── M17 — longitudinal health profile aggregated from prior intakes ───────────
export function mockGetHealthProfile(): HealthProfile {
  // Aggregate from any submitted intakes in the store, falling back to seed data.
  const submitted = Object.values(intakeStore).filter((i) => i.status === 'SUBMITTED');
  const condSet = new Set<string>();
  const allergySet = new Set<string>();
  const medsLines = new Set<string>();
  for (const i of submitted) {
    (Array.isArray(i.answers.conditions_list) ? i.answers.conditions_list : []).forEach((c) => condSet.add(c));
    (Array.isArray(i.answers.allergies_list) ? i.answers.allergies_list : []).forEach((a) => allergySet.add(a));
    formatMedList(i.answers.medications_list).forEach((m) => medsLines.add(m));
  }
  const condLabel = (v: string) => CHRONIC_CONDITION_OPTIONS.find((o) => o.value === v)?.label ?? v;
  const allergyLabel = (v: string) => ALLERGEN_OPTIONS.find((o) => o.value === v)?.label ?? v;

  return {
    subjectId: 'subj_self',
    subjectName: 'Adaeze Okafor',
    conditions: condSet.size
      ? Array.from(condSet).map((c) => ({ label: condLabel(c), value: 'Ongoing' }))
      : [{ label: 'Hypertension', value: 'Ongoing' }],
    medications: medsLines.size
      ? Array.from(medsLines).map((m) => ({ label: m, value: 'Current', critical: true }))
      : [{ label: 'Amlodipine 5mg once daily', value: 'Current', critical: true }],
    allergies: allergySet.size
      ? Array.from(allergySet).map((a) => ({ label: allergyLabel(a), value: 'Reported', critical: true }))
      : [{ label: 'Penicillin', value: 'Reported', critical: true }],
    updatedAt: submitted[0]?.submittedAt ?? daysAgo(1),
    sourceCount: submitted.length || 1,
  };
}
