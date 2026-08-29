// ── Spotlight Academy — EdTech School-Fees module · Constants ────────────────
// Brownfield EXTENSION of the existing `academy` feature (see REUSE-MAP.md §2/§5).
// Mock-first: with EXPO_PUBLIC_ACADEMY_FEES_USE_MOCK=true (the default) every
// PA-/SA- screen renders fully with NO live backend. Flip the flag (or set it to
// 'false') to hit the live academy-fees routes. Money is ALWAYS integers in
// minor units (kobo) — never floats; render via formatNaira from the shared
// academy constants.
//
// IRON RULES honoured here:
//  • SF-6 — installment terms are locked & disclosed BEFORE the first installment
//    (the disclosure screen at PA-06 gates payFirstInstallment).
//  • SF-7 — minor-safe leaderboard: first-name + school only unless recorded
//    guardian consent (the serializer strips PII by default; mock mirrors it).
//  • SF-4 — academic access (leaderboard, competition) is NEVER gated by fee
//    payment status. The competition slice shares no service with the fees slice.

import { mockAllowed } from '@/config/mockPolicy';
import { Colors } from '@/constants/colors';
import type { InvoiceStatus, InstallmentStatus, HardshipStatus } from './types';

// Flip to false (or set EXPO_PUBLIC_ACADEMY_FEES_USE_MOCK=false) once the live
// /api/finance/academy/fees + /competition routes are reachable. Mock-first,
// mirroring the sibling academy / connect / crowdfunding conventions.
export const USE_MOCK =
  mockAllowed(process.env.EXPO_PUBLIC_ACADEMY_FEES_USE_MOCK, true);

// Member REST namespace — the fees + competition endpoints mount under the same
// academy finance group as the rest of the academy module. Confirmed against
// REUSE-MAP.md §4: memberAcad := finance.Group("/academy") → wire base is
// /api/finance/academy/*; RegisterAcademyFees adds fees/* + competition/* under
// it behind FEATURE_ACADEMY_FEES_ENABLED. The blanket Next.js rewrite
// (/api/finance/:path* → Go) covers this base directly.
export const ACADEMY_FEES_API_BASE = '/api/finance/academy';

// Module-scoped colors built strictly on the base design tokens (never hardcode
// hex in screens). Mirrors AcademyColors so the fees screens sit visually inside
// the academy surface.
export const FeesColors = {
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

// ── Invoice status presentation (SF-2: balance derived from payment events) ──
export const INVOICE_STATUS_META: Record<
  InvoiceStatus,
  { label: string; color: string; bg: string }
> = {
  draft:       { label: 'Draft',        color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
  issued:      { label: 'Issued',       color: Colors.secondary,        bg: Colors.iconBgBlue },
  part_paid:   { label: 'Part paid',    color: Colors.onWarning,        bg: Colors.iconBgGold },
  paid:        { label: 'Paid',         color: Colors.teal,             bg: Colors.iconBgTeal },
  overdue:     { label: 'Overdue',      color: Colors.error,            bg: Colors.errorContainer },
  waived:      { label: 'Waived',       color: Colors.teal,             bg: Colors.iconBgTeal },
  cancelled:   { label: 'Cancelled',    color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
};

export const INSTALLMENT_STATUS_META: Record<
  InstallmentStatus,
  { label: string; color: string; bg: string }
> = {
  scheduled: { label: 'Scheduled', color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
  due:       { label: 'Due now',   color: Colors.onWarning,        bg: Colors.iconBgGold },
  paid:      { label: 'Paid',      color: Colors.teal,             bg: Colors.iconBgTeal },
  overdue:   { label: 'Overdue',   color: Colors.error,            bg: Colors.errorContainer },
};

export const HARDSHIP_STATUS_META: Record<
  HardshipStatus,
  { label: string; color: string; bg: string }
> = {
  submitted:  { label: 'Under review', color: Colors.secondary,        bg: Colors.iconBgBlue },
  approved:   { label: 'Approved',     color: Colors.teal,             bg: Colors.iconBgTeal },
  declined:   { label: 'Declined',     color: Colors.error,            bg: Colors.errorContainer },
  needs_info: { label: 'Needs info',   color: Colors.onWarning,        bg: Colors.iconBgGold },
};

// ── Payment methods (PA-05). Wallet + card via the shared provider rail. ─────
export const PAYMENT_METHODS: { value: 'wallet' | 'card' | 'transfer'; label: string; hint: string; icon: string }[] = [
  { value: 'wallet',   label: 'Paymax wallet',   hint: 'Instant · from your balance',       icon: 'Wallet' },
  { value: 'card',     label: 'Debit card',      hint: 'Paystack secure checkout',           icon: 'CreditCard' },
  { value: 'transfer', label: 'Bank transfer',   hint: 'Dedicated virtual account',          icon: 'Landmark' },
];

// ── Installment cadence choices (PA-06). Model A ONLY: guardian pays the school
// over time — Paymax NEVER fronts fees (SF/§4 receivables-factoring bar). ─────
export const INSTALLMENT_PLANS: { value: number; label: string; hint: string }[] = [
  { value: 2, label: '2 installments', hint: 'Half now, half mid-term' },
  { value: 3, label: '3 installments', hint: 'Spread across the term' },
  { value: 4, label: '4 installments', hint: 'Monthly, smallest amounts' },
];

// SF-6 — the mandatory disclosure copy shown before the FIRST installment. The
// terms are locked at invoice issuance (FeeSchedule immutability, SF-1) and shown
// verbatim here; the parent must acknowledge before the plan activates.
export const INSTALLMENT_DISCLOSURE_COPY =
  'This is a fixed installment plan agreed with the school. Paymax does NOT lend you the fees or advance money to the school — you pay the school directly over time. The amounts and dates below are locked and cannot change once you begin. Missing a scheduled installment may affect your standing with the school (it will never block your child’s learning, report card, or competition access). By continuing you confirm you have read and accept these terms.';

// SF-7 — minor-safe leaderboard note surfaced on the cross-school board.
export const MINOR_SAFE_NOTE =
  'To protect under-18 students, public rankings show first name + school only. Full name and photo appear for a student only when a parent or guardian has recorded consent.';

// Auto-save cadence choices for the Fees Vault (PA-08).
export const AUTOSAVE_CADENCES: { value: 'manual' | 'weekly' | 'monthly'; label: string }[] = [
  { value: 'manual',  label: 'Manual only' },
  { value: 'weekly',  label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
];

// Trust-score band presentation for the school directory (PA-16).
export function trustBand(score: number): { label: string; color: string; bg: string } {
  if (score >= 80) return { label: 'Trusted',  color: Colors.teal,      bg: Colors.iconBgTeal };
  if (score >= 60) return { label: 'Verified', color: Colors.secondary, bg: Colors.iconBgBlue };
  if (score >= 40) return { label: 'New',       color: Colors.onWarning, bg: Colors.iconBgGold };
  return { label: 'Unverified', color: Colors.error, bg: Colors.errorContainer };
}
