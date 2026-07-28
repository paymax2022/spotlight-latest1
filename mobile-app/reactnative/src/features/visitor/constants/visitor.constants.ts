import { Colors } from '@/constants/colors';
import type {
  AccessCodeStatus,
  CodeType,
  RestrictionState,
} from '../types/visitor.types';

// Flip to false once the real /visitor endpoints land (or set
// EXPO_PUBLIC_VISITOR_USE_MOCK=false). Mirrors voting/association/fx convention.
export const USE_MOCK = (process.env.EXPO_PUBLIC_VISITOR_USE_MOCK ?? 'true') !== 'false';

// Estate-scoped REST namespace served by the frontend-web API (see api/client).
// Matches the stable /api/v1 convention used by all frontend-web route handlers.
export const VISITOR_API_BASE = '/api/v1/visitor';

// Module-scoped semantic colors, built on top of base design tokens.
// Mirrors the existing `VotingColors` precedent so screens never hardcode hex.
export const VisitorColors = {
  active:    Colors.tertiaryContainer,
  activeBg:  Colors.iconBgTeal,
  activeText: Colors.teal,

  expired:   Colors.outline,
  expiredBg: 'rgba(123,116,131,0.12)',

  revoked:   Colors.error,
  revokedBg: Colors.errorContainer,

  used:      Colors.secondary,
  usedBg:    Colors.iconBgBlue,

  warning:   '#B26B00',
  warningBg: 'rgba(245,158,11,0.12)',

  danger:    Colors.error,
  dangerBg:  Colors.errorContainer,

  success:   Colors.teal,
  successBg: Colors.iconBgTeal,
} as const;

// §9 — guard-visible metadata per code type. `icon` values are lucide-react-native names.
export interface CodeTypeMeta {
  type: CodeType;
  label: string;
  icon: string;
  accent: string;
  bg: string;
  reusable: boolean;
  // default validity in hours; 0 == long-lived/open-ended
  defaultValidityHours: number;
  phase: 1 | 2 | 3; // PRD §16 rollout phase
}

export const CODE_TYPES: CodeTypeMeta[] = [
  { type: 'one_time',        label: 'One-time',     icon: 'UserRound',     accent: Colors.primary,   bg: Colors.iconBgPurple, reusable: false, defaultValidityHours: 6,   phase: 1 },
  { type: 'time_limited',    label: 'Time-limited', icon: 'Timer',         accent: Colors.secondary, bg: Colors.iconBgBlue,   reusable: false, defaultValidityHours: 2,   phase: 1 },
  { type: 'date_specific',   label: 'Date-specific',icon: 'CalendarDays',  accent: Colors.secondary, bg: Colors.iconBgBlue,   reusable: false, defaultValidityHours: 24,  phase: 1 },
  { type: 'multi_day',       label: 'Multi-day',    icon: 'CalendarRange', accent: Colors.teal,      bg: Colors.iconBgTeal,   reusable: true,  defaultValidityHours: 72,  phase: 2 },
  { type: 'recurring',       label: 'Recurring',    icon: 'Repeat',        accent: Colors.teal,      bg: Colors.iconBgTeal,   reusable: true,  defaultValidityHours: 0,   phase: 2 },
  { type: 'delivery',        label: 'Delivery',     icon: 'Package',       accent: '#B26B00',        bg: 'rgba(245,158,11,0.12)', reusable: false, defaultValidityHours: 3, phase: 2 },
  { type: 'ride_hailing',    label: 'Ride',         icon: 'Car',           accent: Colors.secondary, bg: Colors.iconBgBlue,   reusable: false, defaultValidityHours: 2,   phase: 2 },
  { type: 'domestic_staff',  label: 'Staff',        icon: 'BriefcaseBusiness', accent: Colors.primary, bg: Colors.iconBgPurple, reusable: true, defaultValidityHours: 0, phase: 2 },
  { type: 'contractor',      label: 'Contractor',   icon: 'HardHat',       accent: '#B26B00',        bg: 'rgba(245,158,11,0.12)', reusable: true,  defaultValidityHours: 0, phase: 2 },
  { type: 'event_guest',     label: 'Event guest',  icon: 'PartyPopper',   accent: Colors.secondary, bg: Colors.iconBgBlue,   reusable: false, defaultValidityHours: 24,  phase: 3 },
  { type: 'family_permanent',label: 'Family',       icon: 'Users',         accent: Colors.teal,      bg: Colors.iconBgTeal,   reusable: true,  defaultValidityHours: 0,   phase: 2 },
  { type: 'vip',             label: 'VIP',          icon: 'Star',          accent: '#B26B00',        bg: 'rgba(245,158,11,0.12)', reusable: false, defaultValidityHours: 24, phase: 3 },
  { type: 'emergency',       label: 'Emergency',    icon: 'Siren',         accent: Colors.error,     bg: Colors.errorContainer, reusable: false, defaultValidityHours: 1, phase: 1 },
];

export function codeTypeMeta(type: CodeType): CodeTypeMeta {
  return CODE_TYPES.find((c) => c.type === type) ?? CODE_TYPES[0];
}

export const CODE_STATUS_LABELS: Record<AccessCodeStatus, string> = {
  active:  'Active',
  expired: 'Expired',
  revoked: 'Revoked',
  used:    'Used',
};

export const STATUS_STYLE: Record<AccessCodeStatus, { color: string; bg: string }> = {
  active:  { color: VisitorColors.activeText, bg: VisitorColors.activeBg },
  expired: { color: VisitorColors.expired,    bg: VisitorColors.expiredBg },
  revoked: { color: VisitorColors.revoked,    bg: VisitorColors.revokedBg },
  used:    { color: VisitorColors.used,       bg: VisitorColors.usedBg },
};

// §10 — restriction copy used by the resident restriction screen + banner.
export const RESTRICTION_COPY: Record<
  RestrictionState,
  { title: string; body: string; tone: 'ok' | 'warning' | 'danger' | 'pending' }
> = {
  good_standing: {
    title: 'Good standing',
    body: 'You have full access to all visitor features.',
    tone: 'ok',
  },
  soft_restriction: {
    title: 'Payment due soon',
    body: 'You have an outstanding balance. Settle it before the grace period ends to keep visitor access.',
    tone: 'warning',
  },
  hard_ban: {
    title: 'Visitor access disabled',
    body: 'Visitor access is paused because of an overdue balance. Pay now to restore access immediately.',
    tone: 'danger',
  },
  restoration_pending: {
    title: 'Restoring access',
    body: 'We received your payment. Visitor access is being restored — this usually takes a few minutes.',
    tone: 'pending',
  },
  access_restored: {
    title: 'Access restored',
    body: 'Your visitor access is active again. Thank you for settling your balance.',
    tone: 'ok',
  },
};

// VM-208 deny reasons (mandatory reason on deny)
export const DENY_REASONS = [
  'Code expired',
  'Code already used',
  'Code revoked by resident',
  'Resident not reachable',
  'Visitor on blacklist',
  'Details do not match',
  'Other',
] as const;
