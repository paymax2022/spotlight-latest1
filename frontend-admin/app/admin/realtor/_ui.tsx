'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { colors, tint } from '@/components/ui/vuexy';

// Shared presentational helpers for the Realtor console — matches the FX/
// crowdfunding admin light-card inline-style convention (see fx/_ui.tsx).

export const card = (): CSSProperties => ({ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: `1px solid ${colors.inputBorder}`, background: colors.card, cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (bg: string = colors.primary): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: colors.muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: colors.text, fontSize: '0.85rem', borderTop: `1px solid ${colors.border}` });

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  approved: { fg: colors.success, bg: tint(colors.success, 0.12) }, paid: { fg: colors.success, bg: tint(colors.success, 0.12) }, verified: { fg: colors.success, bg: tint(colors.success, 0.12) }, released: { fg: colors.success, bg: tint(colors.success, 0.12) }, held: { fg: colors.info, bg: tint(colors.info, 0.12) },
  pending: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, processing: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, more_info: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, release_requested: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, document_backed: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, inspected: { fg: colors.info, bg: tint(colors.info, 0.12) },
  rejected: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, failed: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, disputed: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, unverified: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, refunded: { fg: colors.muted, bg: colors.bg },
};

export function Badge({ status, label }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status] ?? { fg: colors.text, bg: colors.bg };
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

export function RealtorTabs({ active }: { active: string }) {
  const tabs = [
    { href: '/admin/realtor', label: 'Overview', key: 'overview' },
    { href: '/admin/realtor/moderation', label: 'Listing moderation', key: 'moderation' },
    { href: '/admin/realtor/verification', label: 'Verification', key: 'verification' },
    { href: '/admin/realtor/payments', label: 'Payments & escrow', key: 'payments' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: `1px solid ${colors.border}`, paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : colors.text, background: active === t.key ? colors.primary : colors.bg }}>{t.label}</Link>
      ))}
    </div>
  );
}

export function money(minorKobo: number): string {
  const n = minorKobo / 100;
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
