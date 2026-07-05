'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';

// Shared presentational helpers for the MapService v2 admin console (dashboard +
// OSM contribution review). Matches the light-card inline-style convention used
// across the Connect / Insurance / Stays / Health admin areas (see
// app/admin/health/_ui.tsx) so the Maps pages look native to the rest of admin.

export const card = (): CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (): CSSProperties => ({ ...btn(), border: '1px solid #340075', background: '#340075', color: '#fff', fontWeight: 600 });
export const btnDanger = (): CSSProperties => ({ ...btn(), border: '1px solid #b91c1c', background: '#fff', color: '#b91c1c', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: '#374151', fontSize: '0.85rem', borderTop: '1px solid #f3f4f6', verticalAlign: 'top' });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.55rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' });
export const label = (): CSSProperties => ({ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' });
export const select = (): CSSProperties => ({ ...input(), background: '#fff', cursor: 'pointer' });

const BADGE_COLORS: Record<string, { fg: string; bg: string }> = {
  // circuit / health
  closed: { fg: '#15803d', bg: '#dcfce7' }, up: { fg: '#15803d', bg: '#dcfce7' },
  open: { fg: '#b91c1c', bg: '#fee2e2' }, down: { fg: '#b91c1c', bg: '#fee2e2' },
  half_open: { fg: '#9a3412', bg: '#ffedd5' },
  // coverage tiers
  good: { fg: '#15803d', bg: '#dcfce7' }, fair: { fg: '#9a3412', bg: '#ffedd5' },
  low: { fg: '#b91c1c', bg: '#fee2e2' },
  // contribution status
  pending: { fg: '#9a3412', bg: '#ffedd5' }, approved: { fg: '#15803d', bg: '#dcfce7' },
  rejected: { fg: '#b91c1c', bg: '#fee2e2' }, uploaded: { fg: '#1d4ed8', bg: '#dbeafe' },
  // PII
  stripped: { fg: '#15803d', bg: '#dcfce7' }, pii: { fg: '#b91c1c', bg: '#fee2e2' },
};

export function Badge({ status, label: lbl }: { status: string; label?: string }) {
  const c = BADGE_COLORS[status] ?? { fg: '#374151', bg: '#f3f4f6' };
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

type Tab = { href: string; label: string; key: string };

function Tabs({ active, tabs }: { active: string; tabs: Tab[] }) {
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : '#374151', background: active === t.key ? '#340075' : '#f3f4f6' }}>{t.label}</Link>
      ))}
    </div>
  );
}

export function MapsTabs({ active }: { active: string }) {
  return <Tabs active={active} tabs={[
    { href: '/admin/maps', label: 'Cost & Coverage', key: 'dashboard' },
    { href: '/admin/maps/contributions', label: 'OSM Contributions', key: 'contributions' },
  ]} />;
}

export function StateBlock({ loading, error, empty, emptyText = 'No records found.', children }: PropsWithChildren<{ loading: boolean; error: string | null; empty: boolean; emptyText?: string }>) {
  if (loading) return <p style={{ color: '#6b7280' }}>Loading…</p>;
  if (error) return <p style={{ color: '#dc2626' }}>{error}</p>;
  if (empty) return <p style={{ color: '#6b7280' }}>{emptyText}</p>;
  return <>{children}</>;
}

// Disclosure / explainer banner — purple, matching the health DisclosureNote.
export function DisclosureNote({ children }: PropsWithChildren) {
  return (
    <div style={{ border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#5b21b6', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.78rem', marginBottom: '1rem' }}>
      {children}
    </div>
  );
}

// Inline confirmation / status note (amber).
export function AuditNote({ children }: PropsWithChildren) {
  return (
    <div style={{ border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e', borderRadius: '0.375rem', padding: '0.4rem 0.6rem', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem' }}>
      <span aria-hidden style={{ fontWeight: 700 }}>●</span>
      <span>{children}</span>
    </div>
  );
}

export function FilterBar({ children }: PropsWithChildren) {
  return <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>{children}</div>;
}

// Dependency-free horizontal bar (CSS). value/total → width %.
export function Bar({ label: lbl, value, total, color = '#340075' }: { label: string; value: number; total: number; color?: string }) {
  const ratio = total > 0 ? value / total : 0;
  const widthPct = `${Math.max(0, Math.min(100, ratio * 100)).toFixed(1)}%`;
  return (
    <div style={{ marginBottom: '0.55rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.2rem' }}>
        <span style={{ color: '#374151', textTransform: 'capitalize' }}>{lbl}</span>
        <span style={{ color: '#6b7280' }}>{value.toLocaleString()} · {(ratio * 100).toFixed(1)}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 9999, background: '#f3f4f6', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: widthPct, background: color, borderRadius: 9999 }} />
      </div>
    </div>
  );
}

export function fmtDate(isoStr: string | null | undefined): string {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString('en-NG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
