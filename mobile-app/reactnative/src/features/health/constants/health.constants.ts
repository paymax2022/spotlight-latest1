// ── Paymax Health — Shared constants & design-token map (Phase 0) ────────────
// Built on the base design tokens (DESIGN-Mobile.md). Never hardcode hex in screens —
// resolve everything through HealthColors. Money in kobo → display via formatNaira.

import { mockAllowed } from '@/config/mockPolicy';
import { Colors } from '@/constants/colors';
import type {
  RecordKind,
  ConsentStatus,
  ConsentScope,
  CredentialStatus,
  Vertical,
  IntakeFieldType,
  IntakeStatus,
  RedFlagResult,
} from '../types';

// Flip to false (or set EXPO_PUBLIC_HEALTH_USE_MOCK=false) once the live
// /api/finance/health endpoints are reachable. Mock-first, mirroring the connect/
// crowdfunding conventions.
export const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_HEALTH_USE_MOCK, true);

// Health REST namespace — Go backend mounts the shared health platform + lab/
// pharmacy/vet verticals directly on the finance member group:
//   RegisterHealth(finance, ...)        -> /api/finance/health/*
//   RegisterHealthLab(finance, ...)     -> /api/finance/health/lab/*
//   RegisterHealthPharmacy(finance,...) -> /api/finance/health/pharmacy/*
//   RegisterHealthVet(finance, ...)     -> /api/finance/health/vet/*
// (confirmed in backend/internal/app/finance_routes.go — RegisterHealth*(finance, ...) calls).
// Previously this was wrongly set to '/api/v1/health', which does not exist on
// the Go backend and would 404 every live request.
export const HEALTH_API_BASE = '/api/finance/health';

// Module-scoped colors built strictly on the base design tokens.
export const HealthColors = {
  brand: Colors.primary,
  accent: Colors.secondary,
  ok: Colors.teal,
  okBg: Colors.iconBgTeal,
  warn: Colors.gold,
  warnText: Colors.onWarning,
  danger: Colors.error,
  dangerBg: Colors.errorContainer,
  surface: Colors.surfaceContainerLowest,
  surfaceAlt: Colors.surfaceContainerLow,
  text: Colors.onSurface,
  muted: Colors.onSurfaceVariant,
  border: Colors.outlineVariant,
  white: Colors.white,
} as const;

// Per-vertical accent + icon tint (HEALTH-BUILD §1 care loop).
export const VERTICAL_META: Record<
  Vertical,
  { label: string; icon: string; color: string; iconBg: string; tagline: string; href: string }
> = {
  pharmacy: {
    label: 'Pharmacy',
    icon: 'Pill',
    color: Colors.secondary,
    iconBg: Colors.iconBgBlue,
    tagline: 'Order meds & upload prescriptions',
    href: '/health/pharmacy',
  },
  lab: {
    label: 'Lab Tests',
    icon: 'FlaskConical',
    color: Colors.teal,
    iconBg: Colors.iconBgTeal,
    tagline: 'Book tests & home sample collection',
    href: '/health/lab',
  },
  vet: {
    label: 'Vet Care',
    icon: 'PawPrint',
    color: Colors.primary,
    iconBg: Colors.iconBgPurple,
    tagline: 'Consult a vet for your pets',
    href: '/health/vet',
  },
};

// Record-kind presentation (icon + tint + human label).
export const RECORD_KIND_META: Record<
  RecordKind,
  { label: string; icon: string; color: string; bg: string }
> = {
  prescription: { label: 'Prescription', icon: 'ScrollText', color: Colors.secondary, bg: Colors.iconBgBlue },
  lab_result: { label: 'Lab Result', icon: 'FlaskConical', color: Colors.teal, bg: Colors.iconBgTeal },
  consult_note: { label: 'Consult Note', icon: 'Stethoscope', color: Colors.primary, bg: Colors.iconBgPurple },
  vaccination: { label: 'Vaccination', icon: 'Syringe', color: Colors.teal, bg: Colors.iconBgGreen },
  imaging: { label: 'Imaging', icon: 'Activity', color: Colors.secondary, bg: Colors.iconBgBlue },
  document: { label: 'Document', icon: 'FileText', color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
};

export const CONSENT_STATUS_META: Record<
  ConsentStatus,
  { label: string; color: string; bg: string }
> = {
  active: { label: 'Active', color: Colors.teal, bg: Colors.iconBgTeal },
  revoked: { label: 'Revoked', color: Colors.error, bg: Colors.errorContainer },
  expired: { label: 'Expired', color: Colors.onWarning, bg: Colors.iconBgGold },
};

export const CREDENTIAL_STATUS_META: Record<
  CredentialStatus,
  { label: string; color: string; bg: string; icon: string }
> = {
  verified: { label: 'Verified', color: Colors.teal, bg: Colors.iconBgTeal, icon: 'BadgeCheck' },
  pending: { label: 'Pending review', color: Colors.onWarning, bg: Colors.iconBgGold, icon: 'Clock' },
  expired: { label: 'Expired', color: Colors.error, bg: Colors.errorContainer, icon: 'ShieldAlert' },
};

// Selectable scopes when granting a cross-vertical share.
export const CONSENT_SCOPE_OPTIONS: { value: ConsentScope; label: string }[] = [
  { value: 'all', label: 'All health data' },
  { value: 'prescription', label: 'Prescriptions' },
  { value: 'lab_result', label: 'Lab results' },
  { value: 'consult_note', label: 'Consult notes' },
  { value: 'vaccination', label: 'Vaccinations' },
  { value: 'imaging', label: 'Imaging' },
  { value: 'document', label: 'Documents' },
];

export function scopeLabel(scope: ConsentScope): string {
  return CONSENT_SCOPE_OPTIONS.find((s) => s.value === scope)?.label ?? scope;
}

// Intake field types we render in the schema-driven renderer.
export const INTAKE_FIELD_TYPES: IntakeFieldType[] = [
  'short_text',
  'long_text',
  'number',
  'single_select',
  'multi_select',
  'boolean',
  'date',
  'scale',
  'attachment',
];

// ── Pre-Consult intake status presentation (mirrors ConsultStatusBadge) ───────
export const INTAKE_STATUS_META: Record<
  IntakeStatus | 'NOT_STARTED',
  { label: string; fg: string; bg: string }
> = {
  NOT_STARTED: { label: 'Add health details', fg: Colors.onWarning, bg: Colors.iconBgGold },
  DRAFT: { label: 'Intake in progress', fg: Colors.secondary, bg: Colors.iconBgBlue },
  SUBMITTED: { label: 'Intake ready', fg: Colors.teal, bg: Colors.iconBgTeal },
};

// Red-flag routing presentation (M13). Crisis copy is supportive & resource-led.
export const RED_FLAG_ROUTING_META: Record<
  RedFlagResult['routing'],
  { color: string; bg: string; icon: string }
> = {
  EMERGENCY: { color: Colors.error, bg: Colors.errorContainer, icon: 'Siren' },
  URGENT_CARE: { color: Colors.onWarning, bg: Colors.iconBgGold, icon: 'TriangleAlert' },
  CRISIS: { color: Colors.primary, bg: Colors.iconBgPurple, icon: 'HeartHandshake' },
};

// Not-medical-advice disclaimer surfaced on the wizard (PRD §5.3).
export const INTAKE_NOT_DIAGNOSIS_COPY =
  'These details are patient-reported to help your doctor prepare. They are not a diagnosis or medical advice.';

// NDPA consent copy surfaced anywhere we read/share health data (HL-8).
export const NDPA_CONSENT_COPY =
  'Health data is sensitive personal data under the NDPA 2023. It is encrypted, access-logged, and only shared with an active consent grant you can revoke at any time.';

// Emergency disclaimer (HL-11) — tele-consult is not emergency care.
export const EMERGENCY_DISCLAIMER =
  'A tele-consult is not a substitute for emergency care. If this is an emergency, contact the nearest in-person clinic or emergency service immediately.';

/** ₦ from kobo, grouped thousands. e.g. 1_250_000 → "₦12,500". */
export function formatNaira(kobo: number | null | undefined, opts?: { decimals?: boolean }): string {
  const naira = (kobo ?? 0) / 100;
  return `₦${naira.toLocaleString('en-NG', {
    minimumFractionDigits: opts?.decimals ? 2 : 0,
    maximumFractionDigits: opts?.decimals ? 2 : 0,
  })}`;
}

/** Friendly date for record/consent rows. */
export function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}
