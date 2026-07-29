'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';
import type { TradingKycStatus } from '@/types/tradingAdmin';

// Shared presentational + RBAC helpers for the Trading admin console. Backend RBAC
// (guard("trading.*")) is authoritative — these are UX-only gates.

export const card = (): CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (bg = '#340075'): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 });
export const btnDanger = (): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: '1px solid #b91c1c', background: '#fff', color: '#b91c1c', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 });
export const btnDisabled = (): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: '1px solid #e5e7eb', background: '#f3f4f6', color: '#9ca3af', cursor: 'not-allowed', fontSize: '0.85rem', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: '#374151', fontSize: '0.85rem', borderTop: '1px solid #f3f4f6', verticalAlign: 'top' });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.55rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' });
export const textarea = (): CSSProperties => ({ ...input(), minHeight: '4.5rem', fontFamily: 'inherit', resize: 'vertical' });
export const label = (): CSSProperties => ({ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' });

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

export function TradingTabs({ active }: { active: string }) {
  const tabs = [
    { href: '/admin/trading/kyc', label: 'KYC Review', key: 'kyc' },
    { href: '/admin/trading/bypass', label: 'Bypass Register', key: 'bypass' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : '#374151', background: active === t.key ? '#340075' : '#f3f4f6' }}>{t.label}</Link>
      ))}
    </div>
  );
}

export function Card({ title, children, right }: PropsWithChildren<{ title?: string; right?: ReactNode }>) {
  return (
    <div style={{ ...card(), marginBottom: '1.25rem' }}>
      {title ? <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}><h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>{title}</h2>{right}</div> : null}
      {children}
    </div>
  );
}

export function StateBlock({ loading, error, empty, emptyText = 'No records.', children }: PropsWithChildren<{ loading: boolean; error: string | null; empty: boolean; emptyText?: string }>) {
  if (loading) return <p style={{ color: '#6b7280' }}>Loading…</p>;
  if (error) return <p style={{ color: '#dc2626' }}>{error}</p>;
  if (empty) return <p style={{ color: '#6b7280' }}>{emptyText}</p>;
  return <>{children}</>;
}

export function DisclosureNote({ children }: PropsWithChildren) {
  return <div style={{ border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#5b21b6', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.78rem', marginBottom: '1rem' }}>{children}</div>;
}
export function AuditNote({ children }: PropsWithChildren) {
  return <div style={{ border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e', borderRadius: '0.375rem', padding: '0.4rem 0.6rem', fontSize: '0.72rem', marginTop: '0.5rem' }}>● {children}</div>;
}
export function PermissionBanner({ permission }: { permission: string }) {
  return <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#b91c1c', marginBottom: '1.25rem' }}>You lack <code>{permission}</code>. You can view this console but actions are disabled. Backend RBAC is authoritative.</div>;
}
// Bypass is a controlled two-person exception — this red banner makes that explicit.
export function BypassWarning({ children }: PropsWithChildren) {
  return <div style={{ background: '#fff1f2', border: '1px solid #fda4af', borderRadius: '0.5rem', padding: '0.75rem 1rem', fontSize: '0.82rem', color: '#9f1239', marginBottom: '1rem' }}><strong>Controlled exception.</strong> {children}</div>;
}

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  APPROVED: { fg: '#15803d', bg: '#dcfce7' },
  BYPASSED: { fg: '#6b21a8', bg: '#f3e8ff' },
  SUBMITTED: { fg: '#9a3412', bg: '#ffedd5' },
  UNDER_REVIEW: { fg: '#1d4ed8', bg: '#dbeafe' },
  REJECTED: { fg: '#b91c1c', bg: '#fee2e2' },
  EXPIRED: { fg: '#6b7280', bg: '#f3f4f6' },
  NOT_STARTED: { fg: '#6b7280', bg: '#f3f4f6' },
};
export function StatusBadge({ status }: { status: TradingKycStatus | string }) {
  const c = STATUS_COLORS[status] ?? { fg: '#374151', bg: '#f3f4f6' };
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, whiteSpace: 'nowrap' }}>{String(status).replace(/_/g, ' ')}</span>;
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function timeAgo(s?: string | null): string {
  if (!s) return '—';
  const m = Math.floor((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── RBAC — slugs MUST match migration 20261029000200 ──────────────────────────
export const TRADING_PERMS = {
  review: 'trading.kyc.review',
  bypass: 'trading.kyc.bypass',
  bypassApprove: 'trading.kyc.bypass.approve',
  auditRead: 'trading.audit.read',
} as const;

export function useTradingUser(): AuthUser | null {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => { try { const raw = localStorage.getItem('spotlight_admin_user'); if (raw) setUser(JSON.parse(raw) as AuthUser); } catch { /* route guard handles */ } }, []);
  return user;
}
export function useTradingPermission(...perms: string[]) {
  const user = useTradingUser();
  return { user, allowed: hasAnyPermission(user, perms), permission: perms[0] };
}
export function useCurrentAdminId(): string | null {
  const user = useTradingUser();
  return user?.id ?? null;
}
