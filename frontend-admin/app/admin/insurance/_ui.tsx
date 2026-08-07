'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { colors, tint } from '@/components/ui/vuexy';

// Shared presentational helpers for the Insurance console — matches the Connect /
// Referral admin light-card inline-style convention. All insurance pages import
// from this file via relative path, so everything they need is exported here.

export const card = (): CSSProperties => ({ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: `1px solid ${colors.inputBorder}`, background: colors.card, cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (): CSSProperties => ({ ...btn(), border: `1px solid ${colors.primary}`, background: colors.primary, color: '#fff', fontWeight: 600 });
export const btnDanger = (): CSSProperties => ({ ...btn(), border: `1px solid ${colors.danger}`, background: colors.card, color: colors.danger, fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: colors.muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: colors.text, fontSize: '0.85rem', borderTop: `1px solid ${colors.headBg}` });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' });
export const label = (): CSSProperties => ({ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' });
export const select = (): CSSProperties => ({ ...input(), background: colors.card, cursor: 'pointer' });

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  // generic / lifecycle
  active: { fg: colors.success, bg: tint(colors.success, 0.12) }, approved: { fg: colors.success, bg: tint(colors.success, 0.12) },
  settled: { fg: colors.success, bg: tint(colors.success, 0.12) }, renewed: { fg: colors.success, bg: tint(colors.success, 0.12) },
  reconciled: { fg: colors.success, bg: tint(colors.success, 0.12) }, matched: { fg: colors.success, bg: tint(colors.success, 0.12) },
  resolved: { fg: colors.success, bg: tint(colors.success, 0.12) }, paid: { fg: colors.success, bg: tint(colors.success, 0.12) },
  healthy: { fg: colors.success, bg: tint(colors.success, 0.12) }, up: { fg: colors.success, bg: tint(colors.success, 0.12) },
  open: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, pending: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  pending_payment: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, payout_pending: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  binding: { fg: colors.info, bg: tint(colors.info, 0.12) }, quoted: { fg: colors.info, bg: tint(colors.info, 0.12) },
  under_assessment: { fg: colors.info, bg: tint(colors.info, 0.12) }, fnol_submitted: { fg: colors.info, bg: tint(colors.info, 0.12) },
  needs_more_info: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, renewal_due: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  investigating: { fg: colors.info, bg: tint(colors.info, 0.12) }, reviewing: { fg: colors.info, bg: tint(colors.info, 0.12) },
  draft: { fg: colors.muted, bg: colors.headBg }, expired: { fg: colors.muted, bg: colors.headBg },
  closed: { fg: colors.muted, bg: colors.headBg }, cancelled: { fg: colors.muted, bg: colors.headBg },
  void: { fg: colors.muted, bg: colors.headBg }, inactive: { fg: colors.muted, bg: colors.headBg },
  rejected: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, lapsed: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  failed: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, bind_failed: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  payment_failed: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, break: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  unmatched: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, down: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  degraded: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, reversed: { fg: '#7c3aed', bg: tint('#7c3aed', 0.12) },
  // severity
  low: { fg: colors.muted, bg: colors.headBg }, normal: { fg: colors.info, bg: tint(colors.info, 0.12) },
  medium: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, high: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  critical: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  // binding mode
  embedded: { fg: '#7c3aed', bg: tint('#7c3aed', 0.12) }, voluntary: { fg: colors.info, bg: tint(colors.info, 0.12) },
};

export function Badge({ status, label: lbl }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status] ?? { fg: colors.text, bg: colors.headBg };
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{lbl ?? status.replace(/_/g, ' ')}</span>;
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

export function InsuranceTabs({ active }: { active: string }) {
  const tabs = [
    { href: '/admin/insurance/dashboard', label: 'Overview', key: 'dashboard' },
    { href: '/admin/insurance/catalog', label: 'Catalog', key: 'catalog' },
    { href: '/admin/insurance/policies', label: 'Policies', key: 'policies' },
    { href: '/admin/insurance/claims', label: 'Claims', key: 'claims' },
    { href: '/admin/insurance/premiums', label: 'Finance', key: 'finance' },
    { href: '/admin/insurance/providers', label: 'Providers', key: 'providers' },
    { href: '/admin/insurance/reports', label: 'Ops', key: 'ops' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: `1px solid ${colors.border}`, paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : colors.text, background: active === t.key ? colors.primary : colors.headBg }}>{t.label}</Link>
      ))}
    </div>
  );
}

// Standard loading / empty / error placeholders so every list page is consistent.
export function StateBlock({ loading, error, empty, emptyText = 'No records found.', children }: PropsWithChildren<{ loading: boolean; error: string | null; empty: boolean; emptyText?: string }>) {
  if (loading) return <p style={{ color: colors.muted }}>Loading…</p>;
  if (error) return <p style={{ color: colors.danger }}>{error}</p>;
  if (empty) return <p style={{ color: colors.muted }}>{emptyText}</p>;
  return <>{children}</>;
}

// Disclosure banner — underwriter + aggregator must be shown (PRD §13/§18).
export function DisclosureNote({ children }: PropsWithChildren) {
  return (
    <div style={{ border: `1px solid ${tint('#7c3aed', 0.4)}`, background: tint('#7c3aed', 0.08), color: '#5b21b6', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.78rem', marginBottom: '1rem' }}>
      {children}
    </div>
  );
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

export function fmtDate(isoStr: string | null | undefined): string {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' });
}
