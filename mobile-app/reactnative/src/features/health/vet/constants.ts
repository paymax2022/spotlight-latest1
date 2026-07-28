// ── Paymax Health — Veterinary presentation constants ────────────────────────
// Status → label/colour maps and copy. Resolve all colours through the design
// tokens; never hardcode hex in screens. Money in kobo → display via formatNaira.

import { Colors } from '@/constants/colors';
import type {
  AppointmentStatus,
  AppointmentType,
  PetSpecies,
  RxStatus,
  VaccinationStatus,
  HomeVisitStage,
} from './types';

export const APPT_STATUS_META: Record<AppointmentStatus, { label: string; color: string; bg: string }> = {
  REQUESTED: { label: 'Requested', color: Colors.onWarning, bg: Colors.iconBgGold },
  ACCEPTED: { label: 'Accepted', color: Colors.secondary, bg: Colors.iconBgBlue },
  CONFIRMED: { label: 'Confirmed', color: Colors.secondary, bg: Colors.iconBgBlue },
  IN_PROGRESS: { label: 'In progress', color: Colors.teal, bg: Colors.iconBgTeal },
  COMPLETED: { label: 'Completed', color: Colors.teal, bg: Colors.iconBgTeal },
  RESCHEDULED: { label: 'Rescheduled', color: Colors.onWarning, bg: Colors.iconBgGold },
  CANCELLED: { label: 'Cancelled', color: Colors.error, bg: Colors.errorContainer },
  NO_SHOW: { label: 'No-show', color: Colors.error, bg: Colors.errorContainer },
};

// Ordered timeline (CANCELLED/NO_SHOW handled inline).
export const APPT_TIMELINE: { status: AppointmentStatus; label: string }[] = [
  { status: 'REQUESTED', label: 'Requested' },
  { status: 'ACCEPTED', label: 'Accepted' },
  { status: 'CONFIRMED', label: 'Confirmed' },
  { status: 'IN_PROGRESS', label: 'In progress' },
  { status: 'COMPLETED', label: 'Completed' },
];

export function apptTimelineIndex(status: AppointmentStatus): number {
  if (status === 'RESCHEDULED') return APPT_TIMELINE.findIndex((s) => s.status === 'CONFIRMED');
  const i = APPT_TIMELINE.findIndex((s) => s.status === status);
  return i < 0 ? 0 : i;
}

export const APPT_TYPE_META: Record<AppointmentType, { label: string; icon: string; color: string; bg: string }> = {
  tele: { label: 'Tele-consult', icon: 'Video', color: Colors.secondary, bg: Colors.iconBgBlue },
  home: { label: 'Home visit', icon: 'House', color: Colors.primary, bg: Colors.iconBgPurple },
  clinic: { label: 'Clinic visit', icon: 'MapPin', color: Colors.teal, bg: Colors.iconBgTeal },
};

export const SPECIES_META: Record<PetSpecies, { label: string; icon: string; color: string; bg: string }> = {
  dog: { label: 'Dog', icon: 'Dog', color: Colors.secondary, bg: Colors.iconBgBlue },
  cat: { label: 'Cat', icon: 'Cat', color: Colors.primary, bg: Colors.iconBgPurple },
  bird: { label: 'Bird', icon: 'Bird', color: Colors.teal, bg: Colors.iconBgTeal },
  rabbit: { label: 'Rabbit', icon: 'Rabbit', color: Colors.onWarning, bg: Colors.iconBgGold },
  reptile: { label: 'Reptile', icon: 'Bug', color: Colors.teal, bg: Colors.iconBgGreen },
  other: { label: 'Other', icon: 'PawPrint', color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
};

export const SPECIES_OPTIONS: { value: PetSpecies; label: string }[] = [
  { value: 'dog', label: 'Dog' },
  { value: 'cat', label: 'Cat' },
  { value: 'bird', label: 'Bird' },
  { value: 'rabbit', label: 'Rabbit' },
  { value: 'reptile', label: 'Reptile' },
  { value: 'other', label: 'Other' },
];

export const SEX_OPTIONS: { value: 'male' | 'female' | 'unknown'; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'unknown', label: 'Unknown' },
];

export const RX_STATUS_META: Record<RxStatus, { label: string; color: string; bg: string }> = {
  ISSUED: { label: 'Issued', color: Colors.secondary, bg: Colors.iconBgBlue },
  SENT_TO_PHARMACY: { label: 'Sent to pharmacy', color: Colors.onWarning, bg: Colors.iconBgGold },
  DISPENSED: { label: 'Dispensed', color: Colors.teal, bg: Colors.iconBgTeal },
  EXPIRED: { label: 'Expired', color: Colors.error, bg: Colors.errorContainer },
};

export const VACCINATION_STATUS_META: Record<VaccinationStatus, { label: string; color: string; bg: string }> = {
  up_to_date: { label: 'Up to date', color: Colors.teal, bg: Colors.iconBgTeal },
  due_soon: { label: 'Due soon', color: Colors.onWarning, bg: Colors.iconBgGold },
  overdue: { label: 'Overdue', color: Colors.error, bg: Colors.errorContainer },
  scheduled: { label: 'Scheduled', color: Colors.secondary, bg: Colors.iconBgBlue },
};

export const HOME_VISIT_STAGE_META: Record<HomeVisitStage, { label: string; color: string; bg: string }> = {
  assigned: { label: 'Assigned', color: Colors.secondary, bg: Colors.iconBgBlue },
  en_route: { label: 'On the way', color: Colors.onWarning, bg: Colors.iconBgGold },
  arrived: { label: 'Arrived', color: Colors.teal, bg: Colors.iconBgTeal },
  in_progress: { label: 'Consult in progress', color: Colors.teal, bg: Colors.iconBgTeal },
  completed: { label: 'Completed', color: Colors.teal, bg: Colors.iconBgTeal },
};

export const HOME_VISIT_STAGES: { stage: HomeVisitStage; label: string }[] = [
  { stage: 'assigned', label: 'Vet assigned' },
  { stage: 'en_route', label: 'On the way' },
  { stage: 'arrived', label: 'Arrived' },
  { stage: 'in_progress', label: 'Consult in progress' },
  { stage: 'completed', label: 'Completed' },
];

export const APPT_TYPE_OPTIONS: { value: AppointmentType; label: string }[] = [
  { value: 'tele', label: 'Tele-consult' },
  { value: 'home', label: 'Home visit' },
  { value: 'clinic', label: 'Clinic' },
];

// Intake schema id reused from the shared intake renderer (triage).
export const VET_TRIAGE_SCHEMA_ID = 'vet_triage_v1';

// HL-9 messaging surfaced at checkout: money is held, released on completion.
export const PAYMENT_HELD_COPY =
  'Your payment is held securely and only released to the vet once the consult is completed. It is refunded if the appointment is cancelled.';

// HL-8 consent gate copy before pet records / an e-Rx are unlocked.
export const RECORD_CONSENT_COPY =
  'Your pet’s health records are sensitive data under the NDPA 2023. They are encrypted and access-logged. Confirm to unlock and view.';

// HL-11 emergency disclaimer specific to vet SOS.
export const VET_EMERGENCY_DISCLAIMER =
  'A tele-consult is NOT a substitute for emergency care. If your pet is in distress, bleeding, struggling to breathe, or has ingested something toxic, go to the nearest in-person emergency vet NOW.';

// Care-handoff copy when an e-Rx routes to the pharmacy vertical.
export const RX_HANDOFF_COPY =
  'Send this prescription to a verified pharmacy to fill it. A licensed pharmacist will verify it before dispensing (dispense-once).';

export const VET_SPECIALTIES = [
  'General practice',
  'Surgery',
  'Dermatology',
  'Dentistry',
  'Cardiology',
  'Oncology',
  'Behaviour',
  'Exotic animals',
];

// Common e-Rx form options for the provider prescribe screen.
export const RX_FORM_OPTIONS = ['tablet', 'capsule', 'oral suspension', 'injectable', 'topical', 'drops'];

// Stable idempotency-key minter for money-path mutations (mirrors lab/pharmacy).
export function newIdempotencyKey(prefix = 'vet'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
