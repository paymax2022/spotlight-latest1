'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';
import type { MktListingStatus, MktOrderStatus, MktDisputeStatus, MktBoostStatus, MktFlagStatus } from '@/types/marketplaceAdmin';

// Shared presentational + RBAC helpers for the Paymax Marketplace admin console.
// Matches the existing admin light-card inline-style convention (arena/_ui.tsx,
// kyc-verify/_ui.tsx). Backend RBAC (guard("marketplace.admin.<perm>")) is
// authoritative — everything here is a UX-only gate.

export const card = (): CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (bg = '#340075'): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 });
export const btnDanger = (): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: '1px solid #b91c1c', background: '#fff', color: '#b91c1c', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 });
export const btnDisabled = (): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: '1px solid #e5e7eb', background: '#f3f4f6', color: '#9ca3af', cursor: 'not-allowed', fontSize: '0.85rem', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: '#374151', fontSize: '0.85rem', borderTop: '1px solid #f3f4f6', verticalAlign: 'top' });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.55rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' });
export const label = (): CSSProperties => ({ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' });
export const select = (): CSSProperties => ({ ...input(), background: '#fff', cursor: 'pointer' });
export const textarea = (): CSSProperties => ({ ...input(), minHeight: '4.5rem', fontFamily: 'inherit', resize: 'vertical' });
export const mono = (): CSSProperties => ({ fontFamily: 'monospace', fontSize: '0.8rem' });

type Tab = { href: string; label: string; key: string };

export function MarketplaceTabs({ active }: { active: string }) {
  const tabs: Tab[] = [
    { href: '/admin/marketplace/moderation', label: 'Moderation', key: 'moderation' },
    { href: '/admin/marketplace/taxonomy', label: 'Taxonomy', key: 'taxonomy' },
    { href: '/admin/marketplace/disputes', label: 'Disputes', key: 'disputes' },
    { href: '/admin/marketplace/appeals', label: 'Appeals', key: 'appeals' },
    { href: '/admin/marketplace/users', label: 'Users', key: 'users' },
    { href: '/admin/marketplace/fraud', label: 'Fraud', key: 'fraud' },
    { href: '/admin/marketplace/flags', label: 'Flags', key: 'flags' },
    { href: '/admin/marketplace/orders-aging', label: 'Orders Aging', key: 'orders-aging' },
    { href: '/admin/marketplace/boosts', label: 'Boosts', key: 'boosts' },
    { href: '/admin/marketplace/pricing', label: 'Pricing', key: 'pricing' },
    { href: '/admin/marketplace/analytics', label: 'Analytics', key: 'analytics' },
    { href: '/admin/marketplace/audit-log', label: 'Audit Log', key: 'audit-log' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : '#374151', background: active === t.key ? '#340075' : '#f3f4f6' }}>{t.label}</Link>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{title}</h1>
        {subtitle ? <p style={{ color: '#6b7280', margin: '0.25rem 0 0', fontSize: '0.85rem', maxWidth: 820 }}>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Card({ title, children, right }: PropsWithChildren<{ title?: string; right?: ReactNode }>) {
  return (
    <div style={{ ...card(), marginBottom: '1.25rem' }}>
      {title ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>{title}</h2>
          {right}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function Kpi({ label: lbl, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.85rem 1rem', background: '#fff' }}>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: '#6b7280', fontWeight: 600 }}>{lbl}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem', color: accent ?? '#111827' }}>{value}</div>
      {sub ? <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.15rem' }}>{sub}</div> : null}
    </div>
  );
}

// Standard loading / empty / error placeholders for every list page.
export function StateBlock({ loading, error, empty, emptyText = 'No records found.', children }: PropsWithChildren<{ loading: boolean; error: string | null; empty: boolean; emptyText?: string }>) {
  if (loading) return <p style={{ color: '#6b7280' }}>Loading…</p>;
  if (error) return <p style={{ color: '#dc2626' }}>{error}</p>;
  if (empty) return <p style={{ color: '#6b7280' }}>{emptyText}</p>;
  return <>{children}</>;
}

// Disclosure banner — surfaces the platform invariants operators must respect.
export function DisclosureNote({ children }: PropsWithChildren) {
  return (
    <div style={{ border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#5b21b6', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.78rem', marginBottom: '1rem' }}>
      {children}
    </div>
  );
}

// Amber banner used to flag scaffolded (not-yet-fully-wired) screens.
export function ScaffoldNotice({ children }: PropsWithChildren) {
  return (
    <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#9a3412', marginBottom: '1.25rem' }}>
      <strong>Scaffold.</strong> {children}
    </div>
  );
}

// Inline note that a state-change action is recorded to the immutable audit log.
export function AuditNote({ children }: PropsWithChildren) {
  return (
    <div style={{ border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e', borderRadius: '0.375rem', padding: '0.4rem 0.6rem', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.5rem' }}>
      <span aria-hidden style={{ fontWeight: 700 }}>●</span>
      <span>{children ?? 'Every action here writes an immutable mkt_admin_audit_log row (actor, entity, before/after, reason_code, timestamp).'}</span>
    </div>
  );
}

// Red banner: caller lacks the console's permission — reads allowed, writes gated.
export function PermissionBanner({ permission }: { permission: string }) {
  return (
    <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#b91c1c', marginBottom: '1.25rem' }}>
      You lack <code>{permission}</code>. You can view this console but actions are disabled. Backend RBAC is authoritative.
    </div>
  );
}

// Blue banner for the dual-approval "awaiting second approver" state (§6.3).
export function DualApprovalBanner({ children }: PropsWithChildren) {
  return (
    <div style={{ background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: '0.5rem', padding: '0.75rem 1rem', fontSize: '0.85rem', color: '#1e40af', marginBottom: '1rem' }}>
      <strong>Awaiting second approval.</strong> {children}
    </div>
  );
}

// Inline filter bar wrapper.
export function FilterBar({ children }: PropsWithChildren) {
  return <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>{children}</div>;
}

export function timeAgo(isoStr?: string | null): string {
  if (!isoStr) return '—';
  const diff = Date.now() - new Date(isoStr).getTime();
  const past = diff >= 0;
  const m = Math.floor(Math.abs(diff) / 60_000);
  if (m < 1) return 'just now';
  const fmt = (n: number, u: string) => (past ? `${n}${u} ago` : `in ${n}${u}`);
  if (m < 60) return fmt(m, 'm');
  const h = Math.floor(m / 60);
  if (h < 24) return fmt(h, 'h');
  return fmt(Math.floor(h / 24), 'd');
}

export function fmtDate(isoStr: string | null | undefined): string {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Badges ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  // success / active
  active: { fg: '#15803d', bg: '#dcfce7' }, released: { fg: '#15803d', bg: '#dcfce7' },
  executed: { fg: '#15803d', bg: '#dcfce7' }, approved: { fg: '#15803d', bg: '#dcfce7' },
  actioned: { fg: '#15803d', bg: '#dcfce7' }, completed: { fg: '#15803d', bg: '#dcfce7' },
  purchased: { fg: '#15803d', bg: '#dcfce7' },
  // pending / warn
  pending_review: { fg: '#9a3412', bg: '#ffedd5' }, opened: { fg: '#9a3412', bg: '#ffedd5' },
  evidence_window: { fg: '#9a3412', bg: '#ffedd5' }, under_review: { fg: '#9a3412', bg: '#ffedd5' },
  decided: { fg: '#9a3412', bg: '#ffedd5' }, open: { fg: '#9a3412', bg: '#ffedd5' },
  in_delivery: { fg: '#9a3412', bg: '#ffedd5' }, funded: { fg: '#9a3412', bg: '#ffedd5' },
  seller_accepted: { fg: '#9a3412', bg: '#ffedd5' }, delivered: { fg: '#9a3412', bg: '#ffedd5' },
  inspection_window: { fg: '#9a3412', bg: '#ffedd5' }, initiated: { fg: '#9a3412', bg: '#ffedd5' },
  // in-progress / info (blue)
  disputed: { fg: '#1d4ed8', bg: '#dbeafe' }, appealed: { fg: '#1d4ed8', bg: '#dbeafe' },
  draft: { fg: '#6b7280', bg: '#f3f4f6' }, paused: { fg: '#6b7280', bg: '#f3f4f6' },
  closed: { fg: '#6b7280', bg: '#f3f4f6' }, expired: { fg: '#6b7280', bg: '#f3f4f6' },
  dismissed: { fg: '#6b7280', bg: '#f3f4f6' }, cancelled: { fg: '#6b7280', bg: '#f3f4f6' },
  sold: { fg: '#6b21a8', bg: '#f3e8ff' },
  // danger / terminal-bad
  removed_policy: { fg: '#b91c1c', bg: '#fee2e2' }, removed_user: { fg: '#b91c1c', bg: '#fee2e2' },
  rejected_with_reason: { fg: '#b91c1c', bg: '#fee2e2' },
  // refund / reversal (purple)
  refunded: { fg: '#7c3aed', bg: '#ede9fe' }, split_settled: { fg: '#7c3aed', bg: '#ede9fe' },
  auto_refunded: { fg: '#7c3aed', bg: '#ede9fe' },
};

export function StatusBadge({ status }: { status: MktListingStatus | MktOrderStatus | MktDisputeStatus | MktBoostStatus | MktFlagStatus | string }) {
  const c = STATUS_COLORS[status] ?? { fg: '#374151', bg: '#f3f4f6' };
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{String(status).replace(/_/g, ' ')}</span>;
}

// ── RBAC ──────────────────────────────────────────────────────────────────
// Per-console permissions — MUST match the slugs seeded in
// supabase/migrations/20260905000001_marketplace_rbac_perms.sql and referenced
// in contracts/openapi.yaml (MarketplaceAdmin tag). Server RBAC
// (guard("marketplace.admin.<perm>")) remains authoritative — these are UX gates only.
export const MARKETPLACE_PERMS = {
  moderation: 'marketplace.admin.moderation',
  approve: 'marketplace.admin.approve',
  reject: 'marketplace.admin.reject',
  disputeReview: 'marketplace.admin.dispute.review',
  disputeDecide: 'marketplace.admin.dispute.decide',
  disputeApprove: 'marketplace.admin.dispute.approve',
  flagsAction: 'marketplace.admin.flags.action',
  auditRead: 'marketplace.admin.audit.read',
  ordersAging: 'marketplace.admin.orders.aging',
  taxonomy: 'marketplace.admin.taxonomy',
  analytics: 'marketplace.admin.analytics',
  appealsReview: 'marketplace.admin.appeals.review',
  appealsDecide: 'marketplace.admin.appeals.decide',
  usersView: 'marketplace.admin.users.view',
  usersAction: 'marketplace.admin.users.action',
  pricing: 'marketplace.admin.pricing',
} as const;

export function useMarketplaceUser(): AuthUser | null {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setUser(JSON.parse(raw) as AuthUser);
    } catch { /* unauthenticated handled by route guard */ }
  }, []);
  return user;
}

// Returns whether the caller holds ANY of the given permissions (UX gate).
export function useMarketplacePermission(...permissions: string[]) {
  const user = useMarketplaceUser();
  const allowed = hasAnyPermission(user, permissions);
  return { user, allowed, permission: permissions[0] };
}

// Also expose the current admin's id (masked convention: id or email prefix)
// for the dual-approval "must be a different admin" UX hint.
export function useCurrentAdminId(): string | null {
  const user = useMarketplaceUser();
  return user?.id ?? null;
}
