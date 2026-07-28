// ── Spotlight Academy (K-12 EdTech) — Constants & design-token map ───────────
// Phase 0 + Phase 1, mock-first. Never hardcode hex in screens — resolve through
// AcademyColors which is built strictly on the base design tokens.
// Money in kobo → display via formatNaira. Reward points are plain integers.

import { Colors } from '@/constants/colors';
import type { ExamSlug, MasteryState, OrderStatus } from './types';

// Flip to false (or set EXPO_PUBLIC_ACADEMY_USE_MOCK=false) once the live
// /api/finance/academy endpoints are reachable. Mock-first, mirroring the
// health/connect/crowdfunding conventions — the app runs fully with no backend.
export const USE_MOCK = (process.env.EXPO_PUBLIC_ACADEMY_USE_MOCK ?? 'true') !== 'false';

// Member REST namespace. Confirmed against backend/internal/app/academy_routes.go
// (RegisterAcademy: memberAcad := finance.Group("/academy") → most sub-packages
// mount bare subpaths under this, so the wire base is /api/finance/academy/*;
// see backend/internal/app/finance_routes.go for the FeatureAcademyEnabled gate).
// The blanket Next.js rewrite (/api/finance/:path* → Go) covers this base
// directly — no dedicated frontend-web proxy route is needed, unlike the
// estate-submodule group. NOTE: identity/curriculum/commerce sub-packages are
// registered on the bare finance group (their own paths already embed
// "/academy", e.g. /api/finance/academy/me, /academy/curriculum/...) so both
// families resolve under this same base.
export const ACADEMY_API_BASE = '/api/finance/academy';

// Module-scoped colors built strictly on the base design tokens.
export const AcademyColors = {
  brand: Colors.primary,
  accent: Colors.secondary,
  ok: Colors.teal,
  okBg: Colors.iconBgTeal,
  warn: Colors.gold,
  warnText: Colors.onWarning,
  warnBg: Colors.iconBgGold,
  danger: Colors.error,
  dangerBg: Colors.errorContainer,
  surface: Colors.surfaceContainerLowest,
  surfaceAlt: Colors.surfaceContainerLow,
  text: Colors.onSurface,
  muted: Colors.onSurfaceVariant,
  border: Colors.outlineVariant,
  white: Colors.white,
} as const;

// ── Exam arena presentation ──────────────────────────────────────────────────
export const EXAM_META: Record<
  ExamSlug,
  { label: string; full: string; icon: string; color: string; iconBg: string }
> = {
  utme:   { label: 'UTME',   full: 'JAMB UTME (CBT)',          icon: 'GraduationCap', color: Colors.primary,   iconBg: Colors.iconBgPurple },
  bece:   { label: 'BECE',   full: 'Basic Education Cert.',     icon: 'School',        color: Colors.secondary, iconBg: Colors.iconBgBlue },
  wassce: { label: 'WASSCE', full: 'WAEC SSCE',                 icon: 'Award',         color: Colors.teal,      iconBg: Colors.iconBgTeal },
  neco:   { label: 'NECO',   full: 'NECO SSCE',                 icon: 'Medal',         color: Colors.secondary, iconBg: Colors.iconBgBlue },
  cce:    { label: 'CCE',    full: 'Common Entrance',           icon: 'BookOpenCheck', color: Colors.teal,      iconBg: Colors.iconBgGreen },
  nabteb: { label: 'NABTEB', full: 'NABTEB (Tech/Trade)',       icon: 'Wrench',        color: Colors.gold,      iconBg: Colors.iconBgGold },
};

// ── Mastery state presentation ───────────────────────────────────────────────
export const MASTERY_META: Record<
  MasteryState,
  { label: string; color: string; bg: string }
> = {
  not_started: { label: 'Not started', color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
  learning:    { label: 'Learning',    color: Colors.secondary,        bg: Colors.iconBgBlue },
  proficient:  { label: 'Proficient',  color: Colors.onWarning,        bg: Colors.iconBgGold },
  mastered:    { label: 'Mastered',    color: Colors.teal,             bg: Colors.iconBgTeal },
};

export const ORDER_STATUS_META: Record<
  OrderStatus,
  { label: string; color: string; bg: string }
> = {
  pending:   { label: 'Pending',   color: Colors.onWarning, bg: Colors.iconBgGold },
  paid:      { label: 'Paid',      color: Colors.teal,      bg: Colors.iconBgTeal },
  bnpl:      { label: 'On BNPL',   color: Colors.secondary, bg: Colors.iconBgBlue },
  failed:    { label: 'Failed',    color: Colors.error,     bg: Colors.errorContainer },
  fulfilled: { label: 'Unlocked',  color: Colors.teal,      bg: Colors.iconBgTeal },
};

// Class options for onboarding (A9). Entry class drives new-vs-legacy curriculum.
export const CLASS_OPTIONS: { value: string; label: string; band: 'primary' | 'jss' | 'sss' }[] = [
  { value: 'P1', label: 'Primary 1', band: 'primary' },
  { value: 'P2', label: 'Primary 2', band: 'primary' },
  { value: 'P3', label: 'Primary 3', band: 'primary' },
  { value: 'P4', label: 'Primary 4', band: 'primary' },
  { value: 'P5', label: 'Primary 5', band: 'primary' },
  { value: 'P6', label: 'Primary 6', band: 'primary' },
  { value: 'JSS1', label: 'JSS 1', band: 'jss' },
  { value: 'JSS2', label: 'JSS 2', band: 'jss' },
  { value: 'JSS3', label: 'JSS 3', band: 'jss' },
  { value: 'SSS1', label: 'SSS 1', band: 'sss' },
  { value: 'SSS2', label: 'SSS 2', band: 'sss' },
  { value: 'SSS3', label: 'SSS 3', band: 'sss' },
];

// NDPR / child-safety consent copy surfaced on the guardian-consent screen (A7).
export const GUARDIAN_CONSENT_COPY =
  'Spotlight Academy collects minimal data on learners under 18. Under the NDPA 2023, a parent or guardian must consent before a minor can make purchases, redeem rewards, or join community features. Consent is recorded with an audit trail and can be withdrawn at any time.';

// Server-authoritative timing note shown in the CBT simulator (X7) — client
// countdown is advisory only; the server is the source of truth for scoring/time.
export const CBT_SERVER_AUTH_NOTE =
  'Timer is advisory. Final time and score are confirmed server-side on submit. Your answers are saved locally and sync when you reconnect.';

export const OFFLINE_NOTE =
  'You are offline. Lessons, practice and downloaded mock exams still work. Progress and rewards will sync automatically when you reconnect.';

/** ₦ from kobo, grouped thousands. e.g. 1_250_000 → "₦12,500". */
export function formatNaira(kobo: number | null | undefined, opts?: { decimals?: boolean }): string {
  const naira = (kobo ?? 0) / 100;
  return `₦${naira.toLocaleString('en-NG', {
    minimumFractionDigits: opts?.decimals ? 2 : 0,
    maximumFractionDigits: opts?.decimals ? 2 : 0,
  })}`;
}

/** Reward points with thousands grouping. e.g. 12500 → "12,500 pts". */
export function formatPoints(points: number | null | undefined): string {
  return `${(points ?? 0).toLocaleString('en-NG')} pts`;
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** mm:ss from seconds, for CBT countdowns and time-per-question. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Days until an ISO date (for arena countdowns). Negative if past. */
export function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}
