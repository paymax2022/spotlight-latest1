'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { colors, tint } from '@/components/ui/vuexy';

// Shared presentational helpers for the Direct Referral Rewards console (ADR-022).
// Matches the light-card inline-style convention used across the admin app
// (Referral / Connect / Realtor). Distinct from the superseded house-model
// referral console under /admin/referral.

export const card = (): CSSProperties => ({ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: `1px solid ${colors.inputBorder}`, background: colors.card, cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (): CSSProperties => ({ ...btn(), border: `1px solid ${colors.primary}`, background: colors.primary, color: '#fff', fontWeight: 600 });
export const btnDanger = (): CSSProperties => ({ ...btn(), border: `1px solid ${colors.danger}`, background: colors.card, color: colors.danger, fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: colors.muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: colors.text, fontSize: '0.85rem', borderTop: `1px solid ${colors.border}` });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' });
export const label = (): CSSProperties => ({ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' });

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  pending: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  credited: { fg: colors.success, bg: tint(colors.success, 0.12) },
  paid: { fg: colors.success, bg: tint(colors.success, 0.12) },
  achieved: { fg: colors.info, bg: tint(colors.info, 0.12) },
  active: { fg: colors.success, bg: tint(colors.success, 0.12) },
  reversed: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  voided: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  suspended: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  cleared: { fg: colors.muted, bg: colors.bg },
  open: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  starter: { fg: colors.muted, bg: colors.bg },
  growth: { fg: colors.info, bg: tint(colors.info, 0.12) },
  pro: { fg: colors.primary, bg: tint(colors.primary, 0.12) },
  elite: { fg: colors.warning, bg: tint(colors.warning, 0.18) },
};

export function Badge({ status, label: lbl }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status.toLowerCase()] ?? { fg: colors.text, bg: colors.bg };
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{lbl ?? status.replace(/_/g, ' ').toLowerCase()}</span>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{title}</h1>
        {subtitle ? <p style={{ color: colors.muted, margin: '0.25rem 0 0', fontSize: '0.85rem', maxWidth: 820 }}>{subtitle}</p> : null}
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
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.85rem 1rem', background: colors.card }}>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>{lbl}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem', color: accent ?? colors.text }}>{value}</div>
      {sub ? <div style={{ fontSize: '0.75rem', color: colors.muted, marginTop: '0.15rem' }}>{sub}</div> : null}
    </div>
  );
}

// A1–A7 tab bar for the Direct Referral Rewards console.
export function RewardsTabs({ active }: { active: string }) {
  const tabs = [
    { href: '/admin/referral-rewards/config', label: 'A1 · Config', key: 'config' },
    { href: '/admin/referral-rewards/analytics', label: 'A2 · Analytics', key: 'analytics' },
    { href: '/admin/referral-rewards/fraud', label: 'A3 · Fraud queue', key: 'fraud' },
    { href: '/admin/referral-rewards/ledger', label: 'A4 · Ledger', key: 'ledger' },
    { href: '/admin/referral-rewards/case', label: 'A5 · Case view', key: 'case' },
    { href: '/admin/referral-rewards/milestones', label: 'A6 · Milestones', key: 'milestones' },
    { href: '/admin/referral-rewards/module-status', label: 'A7 · Module status', key: 'module-status' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: `1px solid ${colors.border}`, paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : colors.text, background: active === t.key ? colors.primary : colors.bg }}>{t.label}</Link>
      ))}
    </div>
  );
}

export function StateBlock({ loading, error, empty, emptyText = 'No records found.', children }: PropsWithChildren<{ loading: boolean; error: string | null; empty: boolean; emptyText?: string }>) {
  if (loading) return <p style={{ color: colors.muted }}>Loading…</p>;
  if (error) return <p style={{ color: colors.danger }}>{error}</p>;
  if (empty) return <p style={{ color: colors.muted }}>{emptyText}</p>;
  return <>{children}</>;
}

export function WarningBanner({ children }: PropsWithChildren) {
  return (
    <div style={{ border: `1px solid ${colors.warning}`, background: tint(colors.warning, 0.12), color: colors.warning, borderRadius: '0.5rem', padding: '0.7rem 0.9rem', fontSize: '0.85rem', marginBottom: '1.25rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
      <span aria-hidden style={{ fontWeight: 700 }}>⚠</span>
      <div>{children}</div>
    </div>
  );
}

export function timeAgo(isoStr: string | null): string {
  if (!isoStr) return '—';
  const diff = Date.now() - new Date(isoStr).getTime();
  const past = diff >= 0;
  const h = Math.floor(Math.abs(diff) / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return past ? `${h}h ago` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return past ? `${d}d ago` : `in ${d}d`;
}
