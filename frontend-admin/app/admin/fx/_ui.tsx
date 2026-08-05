'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { colors, tint } from '@/components/ui/vuexy';

// Shared presentational helpers for the FX console. Matches the existing admin
// pages' light-card inline-style convention (see crowdfunding/page.tsx).

export const card = (): CSSProperties => ({ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: `1px solid ${colors.inputBorder}`, background: colors.card, cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (bg = colors.primary): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600 });
export const td = (): CSSProperties => ({ padding: '0.5rem 0.5rem', color: colors.text });

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  successful: { fg: colors.success, bg: tint(colors.success, 0.12) }, paid: { fg: colors.success, bg: tint(colors.success, 0.12) }, settled: { fg: colors.success, bg: tint(colors.success, 0.12) }, clean: { fg: colors.success, bg: tint(colors.success, 0.12) }, healthy: { fg: colors.success, bg: tint(colors.success, 0.12) }, completed: { fg: colors.success, bg: tint(colors.success, 0.12) }, closed: { fg: colors.success, bg: tint(colors.success, 0.12) }, resolved: { fg: colors.success, bg: tint(colors.success, 0.12) },
  processing: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, pending: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, queued: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, low: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, half_open: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, investigating: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, breaks: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, sandbox: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  failed: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, reversed: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, critical: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, open: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, escalated: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, down: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  excess: { fg: colors.info, bg: tint(colors.info, 0.12) }, live: { fg: colors.success, bg: tint(colors.success, 0.12) },
};

export function Badge({ status, label }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status] ?? { fg: colors.muted, bg: colors.headBg };
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, textTransform: 'capitalize' }}>{label ?? status.replace(/_/g, ' ')}</span>;
}

export function Kpi({ label, value, accent, sub }: { label: string; value: string; accent?: string; sub?: string }) {
  return (
    <div style={{ ...card(), padding: '0.9rem 1rem', borderLeft: `3px solid ${accent ?? colors.border}` }}>
      <div style={{ fontSize: '0.75rem', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: 4, color: colors.text }}>{value}</div>
      {sub ? <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{title}</h1>
        {subtitle ? <p style={{ color: colors.muted, margin: '0.25rem 0 0', fontSize: '0.85rem' }}>{subtitle}</p> : null}
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
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: `1px solid ${colors.border}`, paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : colors.text, background: active === t.key ? colors.primary : colors.headBg }}>{t.label}</Link>
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
