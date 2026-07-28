'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';

// Shared presentational helpers for the FX console. Matches the existing admin
// pages' light-card inline-style convention (see crowdfunding/page.tsx).

export const card = (): CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (bg = '#1d4ed8'): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600 });
export const td = (): CSSProperties => ({ padding: '0.5rem 0.5rem', color: '#374151' });

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  successful: { fg: '#15803d', bg: '#dcfce7' }, paid: { fg: '#15803d', bg: '#dcfce7' }, settled: { fg: '#15803d', bg: '#dcfce7' }, clean: { fg: '#15803d', bg: '#dcfce7' }, healthy: { fg: '#15803d', bg: '#dcfce7' }, completed: { fg: '#15803d', bg: '#dcfce7' }, closed: { fg: '#15803d', bg: '#dcfce7' }, resolved: { fg: '#15803d', bg: '#dcfce7' },
  processing: { fg: '#9a3412', bg: '#ffedd5' }, pending: { fg: '#9a3412', bg: '#ffedd5' }, queued: { fg: '#9a3412', bg: '#ffedd5' }, low: { fg: '#9a3412', bg: '#ffedd5' }, half_open: { fg: '#9a3412', bg: '#ffedd5' }, investigating: { fg: '#9a3412', bg: '#ffedd5' }, breaks: { fg: '#9a3412', bg: '#ffedd5' }, sandbox: { fg: '#9a3412', bg: '#ffedd5' },
  failed: { fg: '#b91c1c', bg: '#fee2e2' }, reversed: { fg: '#b91c1c', bg: '#fee2e2' }, critical: { fg: '#b91c1c', bg: '#fee2e2' }, open: { fg: '#b91c1c', bg: '#fee2e2' }, escalated: { fg: '#b91c1c', bg: '#fee2e2' }, down: { fg: '#b91c1c', bg: '#fee2e2' },
  excess: { fg: '#1d4ed8', bg: '#dbeafe' }, live: { fg: '#15803d', bg: '#dcfce7' },
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

export function FxTabs({ active }: { active: string }) {
  const tabs = [
    { href: '/admin/fx', label: 'Overview', key: 'overview' },
    { href: '/admin/fx/transactions', label: 'Transactions', key: 'transactions' },
    { href: '/admin/fx/routing', label: 'Routing', key: 'routing' },
    { href: '/admin/fx/providers', label: 'Providers', key: 'providers' },
    { href: '/admin/fx/treasury', label: 'Treasury', key: 'treasury' },
    { href: '/admin/fx/spread', label: 'Spread', key: 'spread' },
    { href: '/admin/fx/reconciliation', label: 'Reconciliation', key: 'reconciliation' },
    { href: '/admin/fx/customers', label: 'Customers', key: 'customers' },
    { href: '/admin/fx/compliance', label: 'Compliance', key: 'compliance' },
    { href: '/admin/fx/webhooks', label: 'Webhooks', key: 'webhooks' },
    { href: '/admin/fx/analytics', label: 'Analytics', key: 'analytics' },
    { href: '/admin/fx/collections', label: 'Collections', key: 'collections' },
    { href: '/admin/fx/cards', label: 'Cards', key: 'cards' },
    { href: '/admin/fx/settings', label: 'Settings', key: 'settings' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : '#374151', background: active === t.key ? '#1d4ed8' : '#f3f4f6' }}>{t.label}</Link>
      ))}
    </div>
  );
}

// Money: minor units → display. USD-ish cents vs NGN kobo both /100.
export function money(minor: number, currency: string): string {
  const n = minor / 100;
  const sym = currency === 'NGN' ? '₦' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '';
  const body = n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 10_000 ? `${(n / 1_000).toFixed(1)}K` : n.toLocaleString('en-NG', { maximumFractionDigits: 2 });
  return sym ? `${sym}${body}` : `${body} ${currency}`;
}

export function moneyFull(minor: number, currency: string): string {
  const n = minor / 100;
  const sym = currency === 'NGN' ? '₦' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '';
  const body = n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return sym ? `${sym}${body}` : `${body} ${currency}`;
}
