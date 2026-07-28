'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';

// Shared presentational helpers for the Paymax Stays HOTELIER EXTRANET — mirrors
// the ops console kit (app/admin/stays/_ui.tsx) inline-style convention so both
// surfaces look identical. This surface is OBJECT-SCOPED to the signed-in
// hotelier's own property. Money is kobo → ₦ (Naira settlement).

export const card = (): CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (): CSSProperties => ({ ...btn(), border: '1px solid #340075', background: '#340075', color: '#fff', fontWeight: 600 });
export const btnDanger = (): CSSProperties => ({ ...btn(), border: '1px solid #b91c1c', background: '#fff', color: '#b91c1c', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: '#374151', fontSize: '0.85rem', borderTop: '1px solid #f3f4f6', verticalAlign: 'top' });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.55rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' });
export const label = (): CSSProperties => ({ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' });
export const select = (): CSSProperties => ({ ...input(), background: '#fff', cursor: 'pointer' });

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  // success / terminal-good
  active: { fg: '#15803d', bg: '#dcfce7' }, approved: { fg: '#15803d', bg: '#dcfce7' },
  confirmed: { fg: '#15803d', bg: '#dcfce7' }, completed: { fg: '#15803d', bg: '#dcfce7' },
  paid: { fg: '#15803d', bg: '#dcfce7' }, reconciled: { fg: '#15803d', bg: '#dcfce7' },
  published: { fg: '#15803d', bg: '#dcfce7' }, live: { fg: '#15803d', bg: '#dcfce7' },
  verified: { fg: '#15803d', bg: '#dcfce7' }, enrolled: { fg: '#15803d', bg: '#dcfce7' },
  // pending / warn
  pending: { fg: '#9a3412', bg: '#ffedd5' }, pending_review: { fg: '#9a3412', bg: '#ffedd5' },
  scheduled: { fg: '#9a3412', bg: '#ffedd5' }, needs_changes: { fg: '#9a3412', bg: '#ffedd5' },
  submitted: { fg: '#9a3412', bg: '#ffedd5' }, paused: { fg: '#9a3412', bg: '#ffedd5' },
  flagged: { fg: '#9a3412', bg: '#ffedd5' }, no_show: { fg: '#9a3412', bg: '#ffedd5' },
  invited: { fg: '#9a3412', bg: '#ffedd5' }, deposit_held: { fg: '#9a3412', bg: '#ffedd5' },
  pay_at_property: { fg: '#9a3412', bg: '#ffedd5' }, partial: { fg: '#9a3412', bg: '#ffedd5' },
  // in-progress / info (blue)
  in_house: { fg: '#1d4ed8', bg: '#dbeafe' }, in_progress: { fg: '#1d4ed8', bg: '#dbeafe' },
  // neutral / muted
  draft: { fg: '#6b7280', bg: '#f3f4f6' }, ended: { fg: '#6b7280', bg: '#f3f4f6' },
  disabled: { fg: '#6b7280', bg: '#f3f4f6' }, closed: { fg: '#6b7280', bg: '#f3f4f6' },
  low: { fg: '#6b7280', bg: '#f3f4f6' }, room_only: { fg: '#6b7280', bg: '#f3f4f6' },
  // danger / terminal-bad
  rejected: { fg: '#b91c1c', bg: '#fee2e2' }, failed: { fg: '#b91c1c', bg: '#fee2e2' },
  overdue: { fg: '#b91c1c', bg: '#fee2e2' }, held: { fg: '#b91c1c', bg: '#fee2e2' },
  cancelled_by_guest: { fg: '#b91c1c', bg: '#fee2e2' }, cancelled_by_hotel: { fg: '#b91c1c', bg: '#fee2e2' },
  high: { fg: '#b91c1c', bg: '#fee2e2' }, stop_sell: { fg: '#b91c1c', bg: '#fee2e2' },
  refunded: { fg: '#7c3aed', bg: '#ede9fe' },
  // severity / grade
  medium: { fg: '#9a3412', bg: '#ffedd5' },
  // promotion types
  early_bird: { fg: '#1d4ed8', bg: '#dbeafe' }, los: { fg: '#0e7490', bg: '#cffafe' },
  last_minute: { fg: '#9a3412', bg: '#ffedd5' }, mobile: { fg: '#7c3aed', bg: '#ede9fe' },
  // board basis
  breakfast: { fg: '#15803d', bg: '#dcfce7' }, half_board: { fg: '#0e7490', bg: '#cffafe' },
  full_board: { fg: '#1d4ed8', bg: '#dbeafe' }, all_inclusive: { fg: '#7c3aed', bg: '#ede9fe' },
  // channels
  paymax_app: { fg: '#7c3aed', bg: '#ede9fe' }, agent: { fg: '#1d4ed8', bg: '#dbeafe' },
  direct: { fg: '#6b7280', bg: '#f3f4f6' },
  // staff roles
  owner: { fg: '#7c3aed', bg: '#ede9fe' }, revenue_manager: { fg: '#1d4ed8', bg: '#dbeafe' },
  front_desk: { fg: '#0e7490', bg: '#cffafe' },
};

export function Badge({ status, label: lbl }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status] ?? { fg: '#374151', bg: '#f3f4f6' };
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{lbl ?? status.replace(/_/g, ' ')}</span>;
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

// Extranet top nav — the 7 PRD groups (A–G). Each maps to a landing screen.
export function ExtranetTabs({ active }: { active: string }) {
  const tabs = [
    { href: '/extranet/reservations', label: 'Reservations', key: 'reservations' },
    { href: '/extranet/calendar', label: 'Calendar & Rates', key: 'inventory' },
    { href: '/extranet/profile', label: 'Property', key: 'content' },
    { href: '/extranet/promotions', label: 'Promotions', key: 'promotions' },
    { href: '/extranet/payouts', label: 'Finance', key: 'finance' },
    { href: '/extranet/analytics/performance', label: 'Analytics', key: 'analytics' },
    { href: '/extranet/staff', label: 'Account', key: 'account' },
    { href: '/extranet/onboarding/go-live', label: 'Onboarding', key: 'onboarding' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : '#374151', background: active === t.key ? '#340075' : '#f3f4f6' }}>{t.label}</Link>
      ))}
    </div>
  );
}

// Object-scope banner — reminds the hotelier this surface is for THEIR property.
export function PropertyScopeNote({ propertyName }: { propertyName: string }) {
  return (
    <div style={{ border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#5b21b6', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.78rem', marginBottom: '1rem' }}>
      You are managing <strong>{propertyName}</strong>. Everything on this console is scoped to this property only. Settlement is in Nigerian Naira (₦).
    </div>
  );
}

export function StateBlock({ loading, error, empty, emptyText = 'No records found.', children }: PropsWithChildren<{ loading: boolean; error: string | null; empty: boolean; emptyText?: string }>) {
  if (loading) return <p style={{ color: '#6b7280' }}>Loading…</p>;
  if (error) return <p style={{ color: '#dc2626' }}>{error}</p>;
  if (empty) return <p style={{ color: '#6b7280' }}>{emptyText}</p>;
  return <>{children}</>;
}

export function FilterBar({ children }: PropsWithChildren) {
  return <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>{children}</div>;
}

export function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const past = diff >= 0;
  const h = Math.floor(Math.abs(diff) / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return past ? `${h}h ago` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return past ? `${d}d ago` : `in ${d}d`;
}

export function fmtDate(isoStr: string | null | undefined): string {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
