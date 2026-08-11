'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { colors, tint } from '@/components/ui/vuexy';

// Shared presentational helpers for the Paymax Stays ops console — matches the
// Connect / Insurance admin light-card inline-style convention. All stays pages
// import from this file via relative path.

export const card = (): CSSProperties => ({ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: `1px solid ${colors.inputBorder}`, background: colors.card, cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (): CSSProperties => ({ ...btn(), border: `1px solid ${colors.primary}`, background: colors.primary, color: '#fff', fontWeight: 600 });
export const btnDanger = (): CSSProperties => ({ ...btn(), border: `1px solid ${colors.danger}`, background: colors.card, color: colors.danger, fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: colors.muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: colors.text, fontSize: '0.85rem', borderTop: `1px solid ${colors.border}`, verticalAlign: 'top' });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' });
export const label = (): CSSProperties => ({ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' });
export const select = (): CSSProperties => ({ ...input(), background: colors.card, cursor: 'pointer' });

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  // success / terminal-good
  active: { fg: colors.success, bg: tint(colors.success, 0.12) }, approved: { fg: colors.success, bg: tint(colors.success, 0.12) },
  confirmed: { fg: colors.success, bg: tint(colors.success, 0.12) }, completed: { fg: colors.success, bg: tint(colors.success, 0.12) },
  settled: { fg: colors.success, bg: tint(colors.success, 0.12) }, reconciled: { fg: colors.success, bg: tint(colors.success, 0.12) },
  resolved: { fg: colors.success, bg: tint(colors.success, 0.12) }, paid: { fg: colors.success, bg: tint(colors.success, 0.12) },
  merged: { fg: colors.success, bg: tint(colors.success, 0.12) }, healthy: { fg: colors.success, bg: tint(colors.success, 0.12) },
  published: { fg: colors.success, bg: tint(colors.success, 0.12) }, passed: { fg: colors.success, bg: tint(colors.success, 0.12) },
  cleared: { fg: colors.success, bg: tint(colors.success, 0.12) }, rebooked: { fg: colors.success, bg: tint(colors.success, 0.12) },
  bank_verified: { fg: colors.success, bg: tint(colors.success, 0.12) }, up: { fg: colors.success, bg: tint(colors.success, 0.12) },
  // pending / warn
  open: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, pending: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  pending_review: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, scheduled: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  needs_changes: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, needs_info: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  held: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, paused: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  flagged: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, degraded: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  no_show: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  // in-progress / info (blue)
  investigating: { fg: colors.info, bg: tint(colors.info, 0.12) }, reviewing: { fg: colors.info, bg: tint(colors.info, 0.12) },
  booking: { fg: colors.info, bg: tint(colors.info, 0.12) }, payment_held: { fg: colors.info, bg: tint(colors.info, 0.12) },
  prebook_ok: { fg: colors.info, bg: tint(colors.info, 0.12) }, offer_selected: { fg: colors.info, bg: tint(colors.info, 0.12) },
  normal: { fg: colors.info, bg: tint(colors.info, 0.12) }, matched: { fg: colors.success, bg: tint(colors.success, 0.12) },
  // neutral / muted
  draft: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) }, expired: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) },
  closed: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) }, ignored: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) },
  void: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) }, ended: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) },
  split: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) }, disabled: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) },
  low: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) },
  // danger / terminal-bad
  rejected: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, failed: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  book_failed: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, payment_failed: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  cancelled_by_guest: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, cancelled_by_hotel: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  blocked: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, down: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  overbooking: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, high: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  critical: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, refunded: { fg: colors.primary, bg: tint(colors.primary, 0.12) },
  reversed: { fg: colors.primary, bg: tint(colors.primary, 0.12) },
  // severity / grade
  medium: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  // rail / supplier tags
  BEDBANK: { fg: colors.info, bg: tint(colors.info, 0.12) }, DIRECT: { fg: colors.primary, bg: tint(colors.primary, 0.12) },
  ratehawk: { fg: colors.info, bg: tint(colors.info, 0.12) }, zentrumhub: { fg: '#0e7490', bg: '#cffafe' },
  direct: { fg: colors.primary, bg: tint(colors.primary, 0.12) },
  // ledger kinds
  HOLD: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, CHARGE: { fg: colors.success, bg: tint(colors.success, 0.12) },
  RELEASE: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) }, REFUND: { fg: colors.primary, bg: tint(colors.primary, 0.12) },
  COMMISSION: { fg: colors.success, bg: tint(colors.success, 0.12) }, PAYOUT: { fg: colors.info, bg: tint(colors.info, 0.12) },
};

export function Badge({ status, label: lbl }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status] ?? { fg: colors.text, bg: colors.border };
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

export function StaysTabs({ active }: { active: string }) {
  const tabs = [
    { href: '/admin/stays/dashboard', label: 'Overview', key: 'overview' },
    { href: '/admin/stays/suppliers', label: 'Supply', key: 'supply' },
    { href: '/admin/stays/reservations', label: 'Reservations', key: 'reservations' },
    { href: '/admin/stays/reconciliation', label: 'Money', key: 'money' },
    { href: '/admin/stays/loyalty', label: 'Growth', key: 'growth' },
    { href: '/admin/stays/fraud', label: 'Trust & Risk', key: 'trust' },
    { href: '/admin/stays/rbac', label: 'Platform', key: 'platform' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: `1px solid ${colors.border}`, paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : colors.text, background: active === t.key ? colors.primary : colors.border }}>{t.label}</Link>
      ))}
    </div>
  );
}

// Standard loading / empty / error placeholders for every list page.
export function StateBlock({ loading, error, empty, emptyText = 'No records found.', children }: PropsWithChildren<{ loading: boolean; error: string | null; empty: boolean; emptyText?: string }>) {
  if (loading) return <p style={{ color: colors.muted }}>Loading…</p>;
  if (error) return <p style={{ color: colors.danger }}>{error}</p>;
  if (empty) return <p style={{ color: colors.muted }}>{emptyText}</p>;
  return <>{children}</>;
}

// Disclosure banner — dual-rail supplier + FX must be disclosed (PRD §5/§12).
export function DisclosureNote({ children }: PropsWithChildren) {
  return (
    <div style={{ border: `1px solid ${tint(colors.primary, 0.24)}`, background: tint(colors.primary, 0.08), color: colors.primary, borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.78rem', marginBottom: '1rem' }}>
      {children}
    </div>
  );
}

// Inline filter bar wrapper.
export function FilterBar({ children }: PropsWithChildren) {
  return <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>{children}</div>;
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

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
