'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';

// Shared presentational helpers for the Referral console — matches the Connect /
// Realtor admin light-card inline-style convention. RA2 imports from this file
// via relative path, so everything it needs is exported here.

export const card = (): CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (): CSSProperties => ({ ...btn(), border: '1px solid #340075', background: '#340075', color: '#fff', fontWeight: 600 });
export const btnDanger = (): CSSProperties => ({ ...btn(), border: '1px solid #b91c1c', background: '#fff', color: '#b91c1c', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: '#374151', fontSize: '0.85rem', borderTop: '1px solid #f3f4f6' });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.55rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' });
export const label = (): CSSProperties => ({ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' });

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  // generic
  open: { fg: '#9a3412', bg: '#ffedd5' }, pending: { fg: '#9a3412', bg: '#ffedd5' },
  active: { fg: '#15803d', bg: '#dcfce7' }, approved: { fg: '#15803d', bg: '#dcfce7' },
  resolved: { fg: '#15803d', bg: '#dcfce7' }, eligible: { fg: '#15803d', bg: '#dcfce7' },
  paid: { fg: '#15803d', bg: '#dcfce7' }, closed: { fg: '#6b7280', bg: '#f3f4f6' },
  ended: { fg: '#6b7280', bg: '#f3f4f6' }, draft: { fg: '#6b7280', bg: '#f3f4f6' },
  rejected: { fg: '#b91c1c', bg: '#fee2e2' }, clawed_back: { fg: '#b91c1c', bg: '#fee2e2' },
  // severity-style
  low: { fg: '#6b7280', bg: '#f3f4f6' }, normal: { fg: '#1d4ed8', bg: '#dbeafe' },
  high: { fg: '#9a3412', bg: '#ffedd5' }, critical: { fg: '#b91c1c', bg: '#fee2e2' },
  // campaign / reward extras
  scheduled: { fg: '#1d4ed8', bg: '#dbeafe' }, paused: { fg: '#9a3412', bg: '#ffedd5' },
  throttled: { fg: '#9a3412', bg: '#ffedd5' }, earned: { fg: '#1d4ed8', bg: '#dbeafe' },
  vesting: { fg: '#7c3aed', bg: '#ede9fe' }, house: { fg: '#7c3aed', bg: '#ede9fe' },
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
        {subtitle ? <p style={{ color: '#6b7280', margin: '0.25rem 0 0', fontSize: '0.85rem', maxWidth: 760 }}>{subtitle}</p> : null}
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

export function ReferralTabs({ active }: { active: string }) {
  const tabs = [
    { href: '/admin/referral/dashboard', label: 'Overview', key: 'dashboard' },
    { href: '/admin/referral/campaigns', label: 'Campaigns', key: 'campaigns' },
    { href: '/admin/referral/rewards', label: 'Rewards & Ledger', key: 'rewards' },
    { href: '/admin/referral/attribution', label: 'Attribution', key: 'attribution' },
    { href: '/admin/referral/house', label: 'House ledger', key: 'house' },
    { href: '/admin/referral/config', label: 'Config', key: 'config' },
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

export function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const past = diff >= 0;
  const h = Math.floor(Math.abs(diff) / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return past ? `${h}h ago` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return past ? `${d}d ago` : `in ${d}d`;
}
