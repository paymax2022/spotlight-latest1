// ── Paymax AI Symptom Checker — Triage constants & presentation maps ─────────
// Mock-first: reuses the shared health USE_MOCK flag + HEALTH_API_BASE.
// Never hardcode hex — resolve through Colors. Money in kobo.
// SAFETY: SC-1 (no "diagnosis"), SC-8 (disclaimer + emergency everywhere),
// SC-9 (extra caution for child/maternal).

import { Colors } from '@/constants/colors';
import { USE_MOCK, HEALTH_API_BASE } from '@/features/health/constants/health.constants';
import type {
  DispositionLevel,
  CareRoute,
  BodyRegion,
  Language,
} from './types';

// Re-export so triage screens import the flag from one place.
export { USE_MOCK };

/** Member triage REST namespace (frontend-web proxy → Go finance/health/triage). */
export const TRIAGE_API_BASE = `${HEALTH_API_BASE}/triage`;

/** Nigeria emergency dial fallback used by the Emergency screen (SC-8). */
export const AMBULANCE_FALLBACK = 'tel:112';

/**
 * 5-level disposition presentation. Level 1/2 are emergency-urgency (red); they
 * route to the full-screen Emergency flow. NOTE: labels deliberately avoid the
 * word "diagnosis" (SC-1) — they describe urgency + the next step only.
 */
export const DISPOSITION_META: Record<
  DispositionLevel,
  { label: string; sub: string; color: string; bg: string; isEmergency: boolean }
> = {
  1: {
    label: 'Emergency — get help now',
    sub: 'Signs that need urgent in-person care',
    color: Colors.error,
    bg: Colors.errorContainer,
    isEmergency: true,
  },
  2: {
    label: 'Urgent — see care today',
    sub: 'See a clinician within hours',
    color: Colors.error,
    bg: Colors.errorContainer,
    isEmergency: true,
  },
  3: {
    label: 'See a clinician soon',
    sub: 'Book a consult in the next day or two',
    color: Colors.onWarning,
    bg: Colors.iconBgGold,
    isEmergency: false,
  },
  4: {
    label: 'Routine — check when you can',
    sub: 'A pharmacist or lab test can help',
    color: Colors.secondary,
    bg: Colors.iconBgBlue,
    isEmergency: false,
  },
  5: {
    label: 'Self-care for now',
    sub: 'Look after it at home and watch for warning signs',
    color: Colors.teal,
    bg: Colors.iconBgTeal,
    isEmergency: false,
  },
};

export function isEmergencyLevel(level: DispositionLevel): boolean {
  return DISPOSITION_META[level].isEmergency;
}

/** Care-route presentation + the in-app destination it hands off to. */
export const CARE_ROUTE_META: Record<
  CareRoute,
  { label: string; cta: string; icon: string; color: string; href: string }
> = {
  emergency: {
    label: 'Emergency care',
    cta: 'Seek emergency care now',
    icon: 'Ambulance',
    color: Colors.error,
    href: '/health/triage/emergency',
  },
  telemedicine: {
    label: 'Talk to a doctor',
    cta: 'Book a telemedicine consult',
    icon: 'Video',
    color: Colors.primary,
    href: '/health/consult/lobby',
  },
  lab: {
    label: 'Lab test',
    cta: 'Book a lab test',
    icon: 'FlaskConical',
    color: Colors.teal,
    href: '/health/lab',
  },
  pharmacy: {
    label: 'Pharmacist',
    cta: 'Talk to a pharmacist',
    icon: 'Pill',
    color: Colors.secondary,
    href: '/health/pharmacy/pharmacist-consult',
  },
  self_care: {
    label: 'Self-care',
    cta: 'View self-care guidance',
    icon: 'HeartHandshake',
    color: Colors.teal,
    href: '/health/triage/result',
  },
};

/** Tappable body regions for the low-literacy body-map picker. */
export const BODY_REGIONS: { region: BodyRegion; label: string; labelPcm: string }[] = [
  { region: 'head', label: 'Head / face', labelPcm: 'Head / face' },
  { region: 'chest', label: 'Chest', labelPcm: 'Chest' },
  { region: 'abdomen', label: 'Belly / stomach', labelPcm: 'Belle / stomach' },
  { region: 'back', label: 'Back', labelPcm: 'Back' },
  { region: 'pelvis', label: 'Pelvis / private area', labelPcm: 'Pelvis / private area' },
  { region: 'arm', label: 'Arm / hand', labelPcm: 'Hand' },
  { region: 'leg', label: 'Leg / foot', labelPcm: 'Leg / foot' },
  { region: 'skin', label: 'Skin', labelPcm: 'Skin' },
];

/** Big-button common symptoms for low-literacy entry (EN + Pidgin label). */
export const COMMON_SYMPTOMS: { value: string; label: string; labelPcm: string; icon: string }[] = [
  { value: 'fever', label: 'Fever', labelPcm: 'Hot body / fever', icon: 'Thermometer' },
  { value: 'headache', label: 'Headache', labelPcm: 'Headache', icon: 'Brain' },
  { value: 'cough', label: 'Cough', labelPcm: 'Cough', icon: 'Wind' },
  { value: 'stomach_pain', label: 'Stomach pain', labelPcm: 'Belle pain', icon: 'Activity' },
  { value: 'diarrhoea', label: 'Diarrhoea', labelPcm: 'Running belle', icon: 'Droplets' },
  { value: 'body_pain', label: 'Body pain', labelPcm: 'Body dey pain', icon: 'PersonStanding' },
  { value: 'vomiting', label: 'Vomiting', labelPcm: 'Vomit', icon: 'Frown' },
  { value: 'weakness', label: 'Weakness / tired', labelPcm: 'Weak body', icon: 'BatteryLow' },
];

/** Local emergency phone hint shown on the persistent emergency UI. */
export const EMERGENCY_HINT_KEYWORDS = [
  'chest pain',
  'cannot breathe',
  'unconscious',
  'heavy bleeding',
  'seizure',
  'stiff neck',
];

/** Age (years) below which the paediatric caution banner shows (SC-9). */
export const PAEDIATRIC_AGE_YEARS = 12;
