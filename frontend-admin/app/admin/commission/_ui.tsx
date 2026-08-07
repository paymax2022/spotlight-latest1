'use client';

// Shared presentational primitives for the Commission & Profit console. Mirrors the
// inline-style pattern used by the Stays admin (`app/admin/stays/_ui.tsx`) so the two
// consoles look consistent without pulling in a new UI kit.

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

export const th = (): CSSProperties => ({ textAlign: 'left', padding: '0.5rem 0.6rem', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' });
export const td = (): CSSProperties => ({ padding: '0.5rem 0.6rem', fontSize: '0.85rem', borderBottom: '1px solid #f1f1f1', verticalAlign: 'middle' });
export const label = (): CSSProperties => ({ display: 'block', fontSize: '0.72rem', color: '#6b7280', marginBottom: 4 });
export const input = (): CSSProperties => ({ width: '100%', padding: '0.4rem 0.55rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.85rem', boxSizing: 'border-box' });
export const select = (): CSSProperties => ({ ...input() });
export function btn(variant: 'primary' | 'ghost' | 'danger' = 'ghost'): CSSProperties {
  const base: CSSProperties = { padding: '0.45rem 0.85rem', borderRadius: 6, fontSize: '0.82rem', cursor: 'pointer', border: '1px solid #d1d5db', background: '#fff', color: '#111' };
  if (variant === 'primary') return { ...base, background: '#111827', color: '#fff', border: '1px solid #111827' };
  if (variant === 'danger') return { ...base, background: '#fff', color: '#b91c1c', border: '1px solid #fca5a5' };
  return base;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '1.4rem' }}>{title}</h1>
        {subtitle && <p style={{ margin: '0.35rem 0 0', color: '#6b7280', fontSize: '0.85rem', maxWidth: 760 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', marginBottom: '1.25rem' }}>
      {(title || action) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.7rem 0.9rem', borderBottom: '1px solid #f1f1f1' }}>
          <strong style={{ fontSize: '0.9rem' }}>{title}</strong>
          {action}
        </div>
      )}
      <div style={{ padding: '0.9rem' }}>{children}</div>
    </section>
  );
}

export function Kpi({ label: lbl, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '0.8rem 0.9rem', background: '#fff' }}>
      <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{lbl}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 4, color: accent ?? '#111' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function Badge({ label: lbl, tone = 'neutral' }: { label: string; tone?: 'ok' | 'off' | 'neutral' | 'info' }) {
  const map: Record<string, CSSProperties> = {
    ok: { background: '#dcfce7', color: '#15803d' },
    off: { background: '#f3f4f6', color: '#6b7280' },
    info: { background: '#dbeafe', color: '#1d4ed8' },
    neutral: { background: '#f3f4f6', color: '#374151' },
  };
  return <span style={{ ...map[tone], padding: '0.15rem 0.5rem', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{lbl}</span>;
}

export function CommissionTabs({ active }: { active: 'rates' | 'profit' }) {
  const tab = (href: string, key: string, lbl: string): CSSProperties => ({
    padding: '0.45rem 0.9rem', fontSize: '0.85rem', textDecoration: 'none',
    borderBottom: active === key ? '2px solid #111827' : '2px solid transparent',
    color: active === key ? '#111827' : '#6b7280', fontWeight: active === key ? 700 : 500,
  });
  return (
    <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid #e5e7eb', marginBottom: '1.25rem' }}>
      <Link href="/admin/commission" style={tab('/admin/commission', 'rates', 'Rate card')}>Rate card</Link>
      <Link href="/admin/commission/profit" style={tab('/admin/commission/profit', 'profit', 'Profit dashboard')}>Profit dashboard</Link>
    </div>
  );
}

export function StateBlock({ loading, error, empty, emptyText, children }: { loading: boolean; error: string | null; empty: boolean; emptyText: string; children: ReactNode }) {
  if (loading) return <p style={{ color: '#6b7280', fontSize: '0.85rem', padding: '1rem 0' }}>Loading…</p>;
  if (error) return <p style={{ color: '#b91c1c', fontSize: '0.85rem', padding: '1rem 0' }}>{error}</p>;
  if (empty) return <p style={{ color: '#9ca3af', fontSize: '0.85rem', padding: '1rem 0' }}>{emptyText}</p>;
  return <>{children}</>;
}
