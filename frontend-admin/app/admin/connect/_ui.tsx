'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { colors, tint } from '@/components/ui/vuexy';

// Shared presentational helpers for the Connect console — matches the Realtor/FX
// admin light-card inline-style convention (see realtor/_ui.tsx).

export const card = (): CSSProperties => ({ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card, boxShadow: '0 1px 3px rgba(47,43,61,0.06)' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: `1px solid ${colors.inputBorder}`, background: colors.card, color: colors.text, cursor: 'pointer', fontSize: '0.85rem' });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: colors.muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: colors.text, fontSize: '0.85rem', borderTop: `1px solid ${colors.border}` });

const STATUS_COLORS: Record<string, string> = {
  open: colors.warning, investigating: colors.info,
  resolved: colors.success, closed: colors.secondary,
  low: colors.secondary, normal: colors.info,
  high: colors.warning, critical: colors.danger,
};

export function Badge({ status, label }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status] ?? colors.secondary;
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c, background: tint(c, 0.12), textTransform: 'capitalize' }}>{label ?? status.replace(/_/g, ' ')}</span>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: colors.text }}>{title}</h1>
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
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: colors.text }}>{title}</h2>
          {right}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function ConnectTabs({ active }: { active: string }) {
  const tabs = [
    { href: '/admin/connect', label: 'Overview', key: 'overview' },
    { href: '/admin/connect/cases', label: 'Safety cases', key: 'cases' },
    { href: '/admin/connect/audit', label: 'Audit log', key: 'audit' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: `1px solid ${colors.border}`, paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : colors.text, background: active === t.key ? colors.primary : colors.bg }}>{t.label}</Link>
      ))}
    </div>
  );
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
