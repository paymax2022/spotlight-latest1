'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';

// Shared presentational helpers for the Insurance console — matches the Connect /
// Referral admin light-card inline-style convention. All insurance pages import
// from this file via relative path, so everything they need is exported here.

export const card = (): CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (): CSSProperties => ({ ...btn(), border: '1px solid #340075', background: '#340075', color: '#fff', fontWeight: 600 });
export const btnDanger = (): CSSProperties => ({ ...btn(), border: '1px solid #b91c1c', background: '#fff', color: '#b91c1c', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: '#374151', fontSize: '0.85rem', borderTop: '1px solid #f3f4f6' });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.55rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' });
export const label = (): CSSProperties => ({ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' });
export const select = (): CSSProperties => ({ ...input(), background: '#fff', cursor: 'pointer' });

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  // generic / lifecycle
  active: { fg: '#15803d', bg: '#dcfce7' }, approved: { fg: '#15803d', bg: '#dcfce7' },
  settled: { fg: '#15803d', bg: '#dcfce7' }, renewed: { fg: '#15803d', bg: '#dcfce7' },
  reconciled: { fg: '#15803d', bg: '#dcfce7' }, matched: { fg: '#15803d', bg: '#dcfce7' },
  resolved: { fg: '#15803d', bg: '#dcfce7' }, paid: { fg: '#15803d', bg: '#dcfce7' },
  healthy: { fg: '#15803d', bg: '#dcfce7' }, up: { fg: '#15803d', bg: '#dcfce7' },
  open: { fg: '#9a3412', bg: '#ffedd5' }, pending: { fg: '#9a3412', bg: '#ffedd5' },
  pending_payment: { fg: '#9a3412', bg: '#ffedd5' }, payout_pending: { fg: '#9a3412', bg: '#ffedd5' },
  binding: { fg: '#1d4ed8', bg: '#dbeafe' }, quoted: { fg: '#1d4ed8', bg: '#dbeafe' },
  under_assessment: { fg: '#1d4ed8', bg: '#dbeafe' }, fnol_submitted: { fg: '#1d4ed8', bg: '#dbeafe' },
  needs_more_info: { fg: '#9a3412', bg: '#ffedd5' }, renewal_due: { fg: '#9a3412', bg: '#ffedd5' },
  investigating: { fg: '#1d4ed8', bg: '#dbeafe' }, reviewing: { fg: '#1d4ed8', bg: '#dbeafe' },
  draft: { fg: '#6b7280', bg: '#f3f4f6' }, expired: { fg: '#6b7280', bg: '#f3f4f6' },
  closed: { fg: '#6b7280', bg: '#f3f4f6' }, cancelled: { fg: '#6b7280', bg: '#f3f4f6' },
  void: { fg: '#6b7280', bg: '#f3f4f6' }, inactive: { fg: '#6b7280', bg: '#f3f4f6' },
  rejected: { fg: '#b91c1c', bg: '#fee2e2' }, lapsed: { fg: '#b91c1c', bg: '#fee2e2' },
  failed: { fg: '#b91c1c', bg: '#fee2e2' }, bind_failed: { fg: '#b91c1c', bg: '#fee2e2' },
  payment_failed: { fg: '#b91c1c', bg: '#fee2e2' }, break: { fg: '#b91c1c', bg: '#fee2e2' },
  unmatched: { fg: '#b91c1c', bg: '#fee2e2' }, down: { fg: '#b91c1c', bg: '#fee2e2' },
  degraded: { fg: '#9a3412', bg: '#ffedd5' }, reversed: { fg: '#7c3aed', bg: '#ede9fe' },
  // severity
  low: { fg: '#6b7280', bg: '#f3f4f6' }, normal: { fg: '#1d4ed8', bg: '#dbeafe' },
  medium: { fg: '#9a3412', bg: '#ffedd5' }, high: { fg: '#9a3412', bg: '#ffedd5' },
  critical: { fg: '#b91c1c', bg: '#fee2e2' },
  // binding mode
  embedded: { fg: '#7c3aed', bg: '#ede9fe' }, voluntary: { fg: '#1d4ed8', bg: '#dbeafe' },
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

export function InsuranceTabs({ active }: { active: string }) {
  const tabs = [
    { href: '/admin/insurance/dashboard', label: 'Overview', key: 'dashboard' },
    { href: '/admin/insurance/catalog', label: 'Catalog', key: 'catalog' },
    { href: '/admin/insurance/policies', label: 'Policies', key: 'policies' },
    { href: '/admin/insurance/claims', label: 'Claims', key: 'claims' },
    { href: '/admin/insurance/premiums', label: 'Finance', key: 'finance' },
    { href: '/admin/insurance/providers', label: 'Providers', key: 'providers' },
    { href: '/admin/insurance/reports', label: 'Ops', key: 'ops' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : '#374151', background: active === t.key ? '#340075' : '#f3f4f6' }}>{t.label}</Link>
      ))}
    </div>
  );
}

// Standard loading / empty / error placeholders so every list page is consistent.
export function StateBlock({ loading, error, empty, emptyText = 'No records found.', children }: PropsWithChildren<{ loading: boolean; error: string | null; empty: boolean; emptyText?: string }>) {
  if (loading) return <p style={{ color: '#6b7280' }}>Loading…</p>;
  if (error) return <p style={{ color: '#dc2626' }}>{error}</p>;
  if (empty) return <p style={{ color: '#6b7280' }}>{emptyText}</p>;
  return <>{children}</>;
}

// Disclosure banner — underwriter + aggregator must be shown (PRD §13/§18).
export function DisclosureNote({ children }: PropsWithChildren) {
  return (
    <div style={{ border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#5b21b6', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.78rem', marginBottom: '1rem' }}>
      {children}
    </div>
  );
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
