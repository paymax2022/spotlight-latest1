// ── Paymax · Admin Console — Constants ───────────────────────────────────────
// Role labels, the client-side permission map (mirrors backend RBAC; used only
// to show/hide action buttons — the server is always authoritative), status →
// chip styling (design tokens only, like crypto's STATUS_STYLE), and the
// dashboard nav sections. Money/format helpers are re-exported for convenience.

import { Colors } from '@/constants/colors';
import type { Permission, Role } from '../types/admin.types';

// Re-export the format helpers so screens can import everything admin from here.
export {
  formatMoney,
  formatMoneyObj,
  formatMoneyCompact,
  formatBps,
  relativeTime,
  formatDateTime,
  maskMiddle,
} from '../utils/adminFormat';

/** Feature flag gating the whole admin surface. */
export const ADMIN_FEATURE_FLAG = 'admin_console';

// ─── Roles ─────────────────────────────────────────────────────────────────────

export const ROLE_LABEL: Record<Role, string> = {
  SuperAdmin: 'Super Admin',
  ComplianceAdmin: 'Compliance',
  TradingOpsAdmin: 'Trading Ops',
  ProductAdmin: 'Product',
  FinanceAdmin: 'Finance',
  SupportAdmin: 'Support',
  RiskAdmin: 'Risk',
  ContentAdmin: 'Content',
};

/** Ordered list of selectable roles (role chip / settings switcher). */
export const ROLES: Role[] = [
  'SuperAdmin',
  'ComplianceAdmin',
  'TradingOpsAdmin',
  'ProductAdmin',
  'FinanceAdmin',
  'SupportAdmin',
  'RiskAdmin',
  'ContentAdmin',
];

/** Short colour treatment per role for the RoleBadge (design tokens only). */
export const ROLE_STYLE: Record<Role, { fg: string; bg: string }> = {
  SuperAdmin:      { fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple },
  ComplianceAdmin: { fg: Colors.onWarning,             bg: Colors.iconBgGold },
  TradingOpsAdmin: { fg: Colors.secondary,             bg: Colors.iconBgBlue },
  ProductAdmin:    { fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple },
  FinanceAdmin:    { fg: Colors.tertiaryContainer,     bg: Colors.iconBgTeal },
  SupportAdmin:    { fg: Colors.secondary,             bg: Colors.iconBgBlue },
  RiskAdmin:       { fg: Colors.error,                 bg: Colors.iconBgRed },
  ContentAdmin:    { fg: Colors.tertiaryContainer,     bg: Colors.iconBgGreen },
};

// ─── Permissions (mirror backend policy; client-side gate for action buttons) ──
// SuperAdmin holds every permission. Other roles hold the slice they own. These
// are advisory only — privileged actions are re-checked server-side.

const ALL_PERMISSIONS: Permission[] = [
  'kyc.review', 'asset.config', 'withdrawal.approve', 'order.view', 'risk.config',
  'fee.config', 'flag.toggle', 'approval.act', 'recon.view', 'provider.view',
  'audit.view', 'admin.manage', 'user.view',
];

export const PERMISSIONS: Record<Role, Permission[]> = {
  SuperAdmin: [...ALL_PERMISSIONS],
  ComplianceAdmin: ['kyc.review', 'withdrawal.approve', 'user.view', 'audit.view', 'order.view', 'approval.act'],
  TradingOpsAdmin: ['asset.config', 'order.view', 'provider.view', 'recon.view', 'approval.act'],
  ProductAdmin: ['flag.toggle', 'asset.config', 'user.view', 'order.view'],
  FinanceAdmin: ['recon.view', 'fee.config', 'order.view', 'provider.view', 'approval.act'],
  SupportAdmin: ['user.view', 'order.view', 'kyc.review'],
  RiskAdmin: ['risk.config', 'withdrawal.approve', 'kyc.review', 'user.view', 'order.view', 'approval.act'],
  ContentAdmin: ['flag.toggle'],
};

/** True if `role` holds `perm` (client-side button gating). */
export function can(role: Role, perm: Permission): boolean {
  return PERMISSIONS[role]?.includes(perm) ?? false;
}

// ─── Status → chip styling (design tokens only, mirrors CRYPTO_STATUS_STYLE) ───

type ChipStyle = { label: string; fg: string; bg: string };

const OK: Pick<ChipStyle, 'fg' | 'bg'> = { fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal };
const WARN: Pick<ChipStyle, 'fg' | 'bg'> = { fg: Colors.onWarning, bg: Colors.iconBgGold };
const INFO: Pick<ChipStyle, 'fg' | 'bg'> = { fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple };
const BAD: Pick<ChipStyle, 'fg' | 'bg'> = { fg: Colors.error, bg: Colors.iconBgRed };

export const KYC_STATUS_STYLE: Record<string, ChipStyle> = {
  pending:   { label: 'Pending',   ...WARN },
  approved:  { label: 'Approved',  ...OK },
  rejected:  { label: 'Rejected',  ...BAD },
  escalated: { label: 'Escalated', ...INFO },
};

export const ORDER_STATUS_STYLE: Record<string, ChipStyle> = {
  Filled:          { label: 'Filled',     ...OK },
  PartiallyFilled: { label: 'Partial',    ...INFO },
  Processing:      { label: 'Processing', ...INFO },
  Pending:         { label: 'Pending',    ...WARN },
  Failed:          { label: 'Failed',     ...BAD },
  Reversed:        { label: 'Reversed',   ...BAD },
  ComplianceHold:  { label: 'On hold',    ...WARN },
};

export const WITHDRAWAL_STATUS_STYLE: Record<string, ChipStyle> = {
  pending:   { label: 'In review', ...WARN },
  approved:  { label: 'Approved',  ...OK },
  rejected:  { label: 'Rejected',  ...BAD },
  escalated: { label: 'Escalated', ...INFO },
};

export const APPROVAL_STATUS_STYLE: Record<string, ChipStyle> = {
  pending:  { label: 'Pending',  ...WARN },
  approved: { label: 'Approved', ...OK },
  rejected: { label: 'Rejected', ...BAD },
};

/** Asset / user / provider operational status → chip. */
export const ENTITY_STATUS_STYLE: Record<string, ChipStyle> = {
  // asset / user
  active:    { label: 'Active',    ...OK },
  paused:    { label: 'Paused',    ...WARN },
  delisted:  { label: 'Delisted',  ...BAD },
  suspended: { label: 'Suspended', ...BAD },
  closed:    { label: 'Closed',    ...BAD },
  pending:   { label: 'Pending',   ...WARN },
  // provider health
  healthy:   { label: 'Healthy',   ...OK },
  degraded:  { label: 'Degraded',  ...WARN },
  down:      { label: 'Down',      ...BAD },
};

/** Risk-score → chip styling, bucketed by severity. */
export function riskChip(score: number): ChipStyle {
  if (score >= 70) return { label: `Risk ${score}`, ...BAD };
  if (score >= 40) return { label: `Risk ${score}`, ...WARN };
  return { label: `Risk ${score}`, ...OK };
}

// ─── Dashboard nav sections (the console menu grid) ────────────────────────────
// `permission` gates the tile (client-side); `route` is under /admin.

export interface NavSection {
  id: string;
  label: string;
  description: string;
  icon: string; // lucide icon name
  route: string;
  permission: Permission;
}

export const NAV_SECTIONS: NavSection[] = [
  { id: 'users',          label: 'Users',          description: 'Accounts & profiles',     icon: 'Users',         route: '/admin/users',          permission: 'user.view' },
  { id: 'kyc',            label: 'KYC Queue',       description: 'Identity review',         icon: 'ShieldCheck',   route: '/admin/kyc',            permission: 'kyc.review' },
  { id: 'assets',         label: 'Assets',          description: 'Trading controls',        icon: 'Coins',         route: '/admin/assets',         permission: 'asset.config' },
  { id: 'orders',         label: 'Orders',          description: 'Trade activity',          icon: 'ArrowLeftRight', route: '/admin/orders',        permission: 'order.view' },
  { id: 'withdrawals',    label: 'Withdrawals',     description: 'Approve & review',        icon: 'Banknote',      route: '/admin/withdrawals',    permission: 'withdrawal.approve' },
  { id: 'risk',           label: 'Risk Limits',     description: 'Exposure controls',       icon: 'Gauge',         route: '/admin/risk',           permission: 'risk.config' },
  { id: 'fees',           label: 'Fees',            description: 'Pricing config',          icon: 'Percent',       route: '/admin/fees',           permission: 'fee.config' },
  { id: 'flags',          label: 'Feature Flags',   description: 'Toggle features',         icon: 'ToggleRight',   route: '/admin/flags',          permission: 'flag.toggle' },
  { id: 'approvals',      label: 'Approvals',       description: 'Maker-checker queue',     icon: 'CheckCheck',    route: '/admin/approvals',      permission: 'approval.act' },
  { id: 'reconciliation', label: 'Reconciliation',  description: 'Ledger exceptions',       icon: 'Scale',         route: '/admin/reconciliation', permission: 'recon.view' },
  { id: 'providers',      label: 'Providers',       description: 'Integration health',      icon: 'Plug',          route: '/admin/providers',      permission: 'provider.view' },
  { id: 'audit',          label: 'Audit Log',       description: 'Action history',          icon: 'ScrollText',    route: '/admin/audit',          permission: 'audit.view' },
  { id: 'settings',       label: 'Settings',        description: 'Admins & roles',          icon: 'Settings',      route: '/admin/settings',       permission: 'admin.manage' },
];
