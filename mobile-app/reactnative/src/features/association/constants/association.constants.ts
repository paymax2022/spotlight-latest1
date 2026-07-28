// ── Association — Constants ───────────────────────────────────────────────────

import { Colors } from '@/constants/colors';
import type {
  GroupType,
  MemberStatus,
  PaymentStanding,
  InvoiceStatus,
  DuesCadence,
} from '../types/association.types';

/**
 * Mock-vs-live data source. Env-driven so the build can switch to the real
 * /associations endpoints without code changes — set
 *   EXPO_PUBLIC_ASSOCIATION_USE_MOCK=false
 * to go live (default is mock). Mirrors the FX / Doctor module switches.
 *
 * Live endpoints are served under the API client's baseURL (see src/api/client.ts)
 * at the paths documented in contracts/associations.openapi.yaml.
 */
export const USE_MOCK = (process.env.EXPO_PUBLIC_ASSOCIATION_USE_MOCK ?? 'true') !== 'false';

/**
 * Live API base path for the association module.
 *
 * The Go backend mounts the association router under the finance group:
 *   finance := r.Group("/api/finance")
 *   association.RegisterRoutes(finance.Group("/associations"), h)
 * → every endpoint lives at `/api/finance/associations/...`.
 *
 * The shared axios client (`src/api/client.ts`) has baseURL = frontend-web
 * (http://localhost:3000 in dev), which proxies `/api/*` to the Go backend —
 * the same convention the wallet / mobility modules use (`/api/v1`, `/api/finance/...`).
 *
 * Every live path in this module's api/*.ts is built as `${ASSOCIATION_API_BASE}/...`.
 * Keep the mock branches (`if (USE_MOCK)`) intact as the offline fallback.
 */
export const ASSOCIATION_API_BASE = '/api/finance/associations';

export const GROUP_TYPE_LABEL: Record<GroupType, string> = {
  OPEN:        'Open · join instantly',
  CLOSED:      'Closed · approval required',
  INVITE_ONLY: 'Invite-only',
  CODE_BASED:  'Access code',
  PAID:        'Paid membership',
};

/** Status chip styling — pill text + 10% tint background per DESIGN-Mobile.md. */
export const MEMBER_STATUS_STYLE: Record<
  MemberStatus,
  { label: string; color: string; bg: string }
> = {
  ACTIVE:     { label: 'Active',     color: Colors.teal,      bg: Colors.iconBgTeal },
  PENDING:    { label: 'Pending',    color: Colors.gold,      bg: Colors.iconBgGold },
  INACTIVE:   { label: 'Inactive',   color: Colors.outline,   bg: Colors.surfaceContainerHigh },
  SUSPENDED:  { label: 'Suspended',  color: Colors.error,     bg: Colors.errorContainer },
  EXPIRED:    { label: 'Expired',    color: Colors.error,     bg: Colors.errorContainer },
  RESTRICTED: { label: 'Restricted', color: Colors.gold,      bg: Colors.iconBgGold },
};

export const PAYMENT_STANDING_STYLE: Record<
  PaymentStanding,
  { label: string; color: string; bg: string }
> = {
  PAID:    { label: 'Paid up',  color: Colors.teal,  bg: Colors.iconBgTeal },
  DUE:     { label: 'Due',      color: Colors.gold,  bg: Colors.iconBgGold },
  OVERDUE: { label: 'Overdue',  color: Colors.error, bg: Colors.errorContainer },
};

export const INVOICE_STATUS_STYLE: Record<
  InvoiceStatus,
  { label: string; color: string; bg: string }
> = {
  PAID:       { label: 'Paid',       color: Colors.teal,      bg: Colors.iconBgTeal },
  DUE:        { label: 'Due',        color: Colors.gold,      bg: Colors.iconBgGold },
  OVERDUE:    { label: 'Overdue',    color: Colors.error,     bg: Colors.errorContainer },
  PROCESSING: { label: 'Processing', color: Colors.secondary, bg: Colors.iconBgBlue },
};

export const CADENCE_LABEL: Record<DuesCadence, string> = {
  ONE_OFF:   'One-off',
  MONTHLY:   '/month',
  QUARTERLY: '/quarter',
  ANNUAL:    '/year',
  LIFETIME:  'Lifetime',
};

/** Directory filter segments (status). */
export const DIRECTORY_STATUS_SEGMENTS = [
  { value: 'all',       label: 'All' },
  { value: 'ACTIVE',    label: 'Active' },
  { value: 'PENDING',   label: 'Pending' },
  { value: 'SUSPENDED', label: 'Suspended' },
] as const;

/** Dues filter segments. */
export const DUES_SEGMENTS = [
  { value: 'all',     label: 'All' },
  { value: 'DUE',     label: 'Outstanding' },
  { value: 'PAID',    label: 'Paid' },
] as const;
