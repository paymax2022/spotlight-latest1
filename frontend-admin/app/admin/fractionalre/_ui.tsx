'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';

// Shared presentational helpers for the Fractional Real Estate console.
// Matches the Estate/Realtor console light-card inline-style convention.

export const card = (): CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (bg = '#1d4ed8'): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: '#374151', fontSize: '0.85rem', borderTop: '1px solid #f3f4f6' });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.6rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.85rem', width: '100%' });
export const label = (): CSSProperties => ({ fontSize: '0.78rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 });

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  // green — healthy / done
  active: { fg: '#15803d', bg: '#dcfce7' }, verified: { fg: '#15803d', bg: '#dcfce7' }, completed: { fg: '#15803d', bg: '#dcfce7' },
  approved: { fg: '#15803d', bg: '#dcfce7' }, funded: { fg: '#15803d', bg: '#dcfce7' }, operational: { fg: '#15803d', bg: '#dcfce7' },
  allocated: { fg: '#15803d', bg: '#dcfce7' }, clear: { fg: '#15803d', bg: '#dcfce7' }, minmet: { fg: '#15803d', bg: '#dcfce7' },
  // amber — in progress / attention
  pending: { fg: '#9a3412', bg: '#ffedd5' }, underreview: { fg: '#9a3412', bg: '#ffedd5' }, titleverification: { fg: '#9a3412', bg: '#ffedd5' },
  draft: { fg: '#6b7280', bg: '#f3f4f6' }, calculated: { fg: '#9a3412', bg: '#ffedd5' }, pendingapproval: { fg: '#9a3412', bg: '#ffedd5' },
  closing: { fg: '#9a3412', bg: '#ffedd5' }, distributing: { fg: '#9a3412', bg: '#ffedd5' }, query: { fg: '#9a3412', bg: '#ffedd5' },
  executing: { fg: '#9a3412', bg: '#ffedd5' }, refunding: { fg: '#9a3412', bg: '#ffedd5' }, medium: { fg: '#9a3412', bg: '#ffedd5' },
  // red — bad / blocked
  rejected: { fg: '#b91c1c', bg: '#fee2e2' }, halted: { fg: '#b91c1c', bg: '#fee2e2' }, suspended: { fg: '#b91c1c', bg: '#fee2e2' },
  cancelled: { fg: '#b91c1c', bg: '#fee2e2' }, expired: { fg: '#b91c1c', bg: '#fee2e2' }, partiallyfailed: { fg: '#b91c1c', bg: '#fee2e2' },
  high: { fg: '#b91c1c', bg: '#fee2e2' }, critical: { fg: '#b91c1c', bg: '#fee2e2' }, breached: { fg: '#b91c1c', bg: '#fee2e2' },
  // blue / purple — neutral states
  fundingopen: { fg: '#1d4ed8', bg: '#dbeafe' }, open: { fg: '#1d4ed8', bg: '#dbeafe' }, low: { fg: '#1d4ed8', bg: '#dbeafe' },
  primary: { fg: '#1d4ed8', bg: '#dbeafe' }, secondary: { fg: '#6b21a8', bg: '#f3e8ff' }, matched: { fg: '#6b21a8', bg: '#f3e8ff' },
  retail: { fg: '#1d4ed8', bg: '#dbeafe' }, qualified: { fg: '#6b21a8', bg: '#f3e8ff' }, hni: { fg: '#15803d', bg: '#dcfce7' }, institutional: { fg: '#6b21a8', bg: '#f3e8ff' },
};

export function Badge({ status, label: lbl }: { status: string; label?: string }) {
  const c = STATUS_COLORS[String(status).toLowerCase()] ?? { fg: '#374151', bg: '#f3f4f6' };
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, textTransform: 'capitalize' }}>{lbl ?? String(status).replace(/_/g, ' ')}</span>;
}

export function Kpi({ label: lbl, value, accent, sub }: { label: string; value: string; accent?: string; sub?: string }) {
  return (
    <div style={{ ...card(), padding: '0.9rem 1rem', borderLeft: `3px solid ${accent ?? '#e5e7eb'}` }}>
      <div style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>{lbl}</div>
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

// SoD / maker-checker advisory banner used across compliance/distribution/title pages.
export function SodNote({ children }: PropsWithChildren) {
  return (
    <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '0.5rem', padding: '0.6rem 0.85rem', fontSize: '0.8rem', color: '#92400e', marginBottom: '1rem' }}>
      <strong>Segregation of duties:</strong> {children}
    </div>
  );
}

export function FractionalReTabs({ active }: { active: string }) {
  const tabs = [
    { href: '/admin/fractionalre', label: 'Dashboard', key: 'dashboard' },
    { href: '/admin/fractionalre/assets', label: 'Assets', key: 'assets' },
    { href: '/admin/fractionalre/rounds', label: 'Rounds', key: 'rounds' },
    { href: '/admin/fractionalre/cap-table', label: 'Cap Table', key: 'cap-table' },
    { href: '/admin/fractionalre/investors', label: 'Investors', key: 'investors' },
    { href: '/admin/fractionalre/compliance', label: 'Compliance', key: 'compliance' },
    { href: '/admin/fractionalre/distributions', label: 'Distributions', key: 'distributions' },
    { href: '/admin/fractionalre/market', label: 'Market', key: 'market' },
    { href: '/admin/fractionalre/sponsors', label: 'Sponsors', key: 'sponsors' },
    { href: '/admin/fractionalre/finance', label: 'Finance', key: 'finance' },
    { href: '/admin/fractionalre/documents', label: 'Documents', key: 'documents' },
    { href: '/admin/fractionalre/audit', label: 'Audit', key: 'audit' },
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
  const body = n >= 1_000_000_000 ? `${(n / 1_000_000_000).toFixed(2)}B` : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 10_000 ? `${(n / 1_000).toFixed(1)}K` : n.toLocaleString('en-NG', { maximumFractionDigits: 0 });
  return `₦${body}`;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const past = diff >= 0;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3_600_000);
  if (h < 1) return past ? 'just now' : 'soon';
  if (h < 24) return past ? `${h}h ago` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return past ? `${d}d ago` : `in ${d}d`;
}
