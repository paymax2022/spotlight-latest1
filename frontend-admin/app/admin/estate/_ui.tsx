'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';

// Shared presentational helpers for the Estate console — matches the Realtor
// console light-card inline-style convention (see realtor/_ui.tsx).

export const card = (): CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (bg = '#1d4ed8'): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: '#374151', fontSize: '0.85rem', borderTop: '1px solid #f3f4f6' });

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  active: { fg: '#15803d', bg: '#dcfce7' }, paid: { fg: '#15803d', bg: '#dcfce7' }, verified: { fg: '#15803d', bg: '#dcfce7' }, online: { fg: '#15803d', bg: '#dcfce7' }, on_duty: { fg: '#15803d', bg: '#dcfce7' }, resolved: { fg: '#15803d', bg: '#dcfce7' }, completed: { fg: '#15803d', bg: '#dcfce7' },
  pending: { fg: '#9a3412', bg: '#ffedd5' }, scheduled: { fg: '#9a3412', bg: '#ffedd5' }, investigating: { fg: '#9a3412', bg: '#ffedd5' }, maintenance: { fg: '#9a3412', bg: '#ffedd5' }, medium: { fg: '#9a3412', bg: '#ffedd5' },
  overdue: { fg: '#b91c1c', bg: '#fee2e2' }, banned: { fg: '#b91c1c', bg: '#fee2e2' }, restricted: { fg: '#b91c1c', bg: '#fee2e2' }, rejected: { fg: '#b91c1c', bg: '#fee2e2' }, suspended: { fg: '#b91c1c', bg: '#fee2e2' }, offline: { fg: '#b91c1c', bg: '#fee2e2' }, open: { fg: '#b91c1c', bg: '#fee2e2' }, missed: { fg: '#b91c1c', bg: '#fee2e2' }, high: { fg: '#b91c1c', bg: '#fee2e2' }, critical: { fg: '#b91c1c', bg: '#fee2e2' },
  low: { fg: '#1d4ed8', bg: '#dbeafe' }, owner: { fg: '#1d4ed8', bg: '#dbeafe' }, tenant: { fg: '#6b21a8', bg: '#f3e8ff' },
};

export function Badge({ status, label }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status] ?? { fg: '#374151', bg: '#f3f4f6' };
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, textTransform: 'capitalize' }}>{label ?? status.replace(/_/g, ' ')}</span>;
}

export function Kpi({ label, value, accent, sub }: { label: string; value: string; accent?: string; sub?: string }) {
  return (
    <div style={{ ...card(), padding: '0.9rem 1rem', borderLeft: `3px solid ${accent ?? '#e5e7eb'}` }}>
      <div style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: 4, color: '#111827' }}>{value}</div>
      {sub ? <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{title}</h1>
        {subtitle ? <p style={{ color: '#6b7280', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Card({ title, children, right }: PropsWithChildren<{ title?: string; right?: ReactNode }>) {
  return (
    <div style={{ ...card(), marginBottom: '1.25rem' }}>
      {title ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>{title}</h2>
          {right}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function EstateTabs({ active }: { active: string }) {
  const tabs = [
    { href: '/admin/estate', label: 'Dashboard', key: 'dashboard' },
    { href: '/admin/estate/residents', label: 'Residents & units', key: 'residents' },
    { href: '/admin/estate/dues', label: 'Dues & collections', key: 'dues' },
    { href: '/admin/estate/gates', label: 'Gates & security', key: 'gates' },
    { href: '/admin/estate/vendors', label: 'Vendors', key: 'vendors' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : '#374151', background: active === t.key ? '#1d4ed8' : '#f3f4f6' }}>{t.label}</Link>
      ))}
    </div>
  );
}

// Naira from kobo (integer minor units).
export function naira(kobo: number): string {
  return `₦${(((kobo ?? 0) / 100)).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function money(minorKobo: number): string {
  const n = (minorKobo ?? 0) / 100;
  const body = n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 10_000 ? `${(n / 1_000).toFixed(1)}K` : n.toLocaleString('en-NG', { maximumFractionDigits: 0 });
  return `₦${body}`;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
