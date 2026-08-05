'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { colors, tint } from '@/components/ui/vuexy';

// Shared presentational helpers for the Paymax Events (Ticketing + Cashless) and
// Loyalty ops consoles. Matches the Connect / Insurance / Stays / Savings admin
// light-card inline-style convention (copied from savings/_ui.tsx). Both
// app/admin/events/* and app/admin/loyalty/* import from this single file.

export const card = (): CSSProperties => ({ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: `1px solid ${colors.inputBorder}`, background: colors.card, cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (): CSSProperties => ({ ...btn(), border: `1px solid ${colors.primary}`, background: colors.primary, color: '#fff', fontWeight: 600 });
export const btnDanger = (): CSSProperties => ({ ...btn(), border: `1px solid ${colors.danger}`, background: colors.card, color: colors.danger, fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: colors.muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: colors.text, fontSize: '0.85rem', borderTop: `1px solid ${colors.headBg}`, verticalAlign: 'top' });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' });
export const label = (): CSSProperties => ({ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' });
export const select = (): CSSProperties => ({ ...input(), background: colors.card, cursor: 'pointer' });

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  // success / terminal-good
  active: { fg: colors.success, bg: tint(colors.success, 0.12) }, approved: { fg: colors.success, bg: tint(colors.success, 0.12) },
  live: { fg: colors.success, bg: tint(colors.success, 0.12) }, completed: { fg: colors.success, bg: tint(colors.success, 0.12) },
  settled: { fg: colors.success, bg: tint(colors.success, 0.12) }, reconciled: { fg: colors.success, bg: tint(colors.success, 0.12) },
  resolved: { fg: colors.success, bg: tint(colors.success, 0.12) }, paid: { fg: colors.success, bg: tint(colors.success, 0.12) },
  healthy: { fg: colors.success, bg: tint(colors.success, 0.12) }, on_sale: { fg: colors.success, bg: tint(colors.success, 0.12) },
  cleared: { fg: colors.success, bg: tint(colors.success, 0.12) }, balanced: { fg: colors.success, bg: tint(colors.success, 0.12) },
  kyc_verified: { fg: colors.success, bg: tint(colors.success, 0.12) }, published: { fg: colors.success, bg: tint(colors.success, 0.12) },
  // pending / warn
  pending: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, submitted: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  scheduled: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, queued: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  flagged: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, paused: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  kyc_hold: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, spending: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  // in-progress / info (blue)
  investigating: { fg: colors.info, bg: tint(colors.info, 0.12) }, processing: { fg: colors.info, bg: tint(colors.info, 0.12) },
  open: { fg: colors.info, bg: tint(colors.info, 0.12) }, normal: { fg: colors.info, bg: tint(colors.info, 0.12) },
  // neutral / muted
  draft: { fg: colors.muted, bg: colors.headBg }, expired: { fg: colors.muted, bg: colors.headBg },
  closed: { fg: colors.muted, bg: colors.headBg }, ignored: { fg: colors.muted, bg: colors.headBg },
  ended: { fg: colors.muted, bg: colors.headBg }, low: { fg: colors.muted, bg: colors.headBg },
  disabled: { fg: colors.muted, bg: colors.headBg }, dismissed: { fg: colors.muted, bg: colors.headBg },
  sold_out: { fg: colors.muted, bg: colors.headBg },
  // danger / terminal-bad
  rejected: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, failed: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  blocked: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, suspended: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  high: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, critical: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  breached: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  // refund / reversal (purple)
  refunded: { fg: '#7c3aed', bg: tint('#7c3aed', 0.12) }, reversed: { fg: '#7c3aed', bg: tint('#7c3aed', 0.12) },
  // severity / grade
  medium: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  // KYC tiers
  tier0: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, tier1: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  tier2: { fg: colors.info, bg: tint(colors.info, 0.12) }, tier3: { fg: colors.success, bg: tint(colors.success, 0.12) },
  // loyalty redemption kinds
  airtime: { fg: colors.info, bg: tint(colors.info, 0.12) }, bill_credit: { fg: '#0e7490', bg: tint('#0e7490', 0.12) },
  ticket_discount: { fg: '#7c3aed', bg: tint('#7c3aed', 0.12) }, perk: { fg: colors.success, bg: tint(colors.success, 0.12) },
  // fraud kinds
  dup_scan: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, abnormal_topup: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  rapid_refund: { fg: '#7c3aed', bg: tint('#7c3aed', 0.12) }, vendor_self_charge: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  // modules
  payments: { fg: colors.info, bg: tint(colors.info, 0.12) }, savings: { fg: colors.success, bg: tint(colors.success, 0.12) },
  tickets: { fg: '#7c3aed', bg: tint('#7c3aed', 0.12) }, cashless: { fg: '#0e7490', bg: tint('#0e7490', 0.12) },
  referral: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, social: { fg: colors.info, bg: tint(colors.info, 0.12) },
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

type Tab = { href: string; label: string; key: string };

function Tabs({ active, tabs }: { active: string; tabs: Tab[] }) {
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: `1px solid ${colors.border}`, paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : colors.text, background: active === t.key ? colors.primary : colors.headBg }}>{t.label}</Link>
      ))}
    </div>
  );
}

export function EventsTabs({ active }: { active: string }) {
  return <Tabs active={active} tabs={[
    { href: '/admin/events/dashboard', label: 'Overview', key: 'overview' },
    { href: '/admin/events/approval', label: 'Approvals', key: 'approval' },
    { href: '/admin/events/events', label: 'Events', key: 'events' },
    { href: '/admin/events/tickets', label: 'Tickets', key: 'tickets' },
    { href: '/admin/events/cashless', label: 'Cashless', key: 'cashless' },
    { href: '/admin/events/vendors', label: 'Vendors', key: 'vendors' },
    { href: '/admin/events/settlement', label: 'Settlement', key: 'settlement' },
    { href: '/admin/events/fraud', label: 'Fraud', key: 'fraud' },
  ]} />;
}

export function LoyaltyTabs({ active }: { active: string }) {
  return <Tabs active={active} tabs={[
    { href: '/admin/loyalty/dashboard', label: 'Overview', key: 'overview' },
    { href: '/admin/loyalty/earn-rules', label: 'Earn rules', key: 'earn-rules' },
    { href: '/admin/loyalty/tiers', label: 'Tiers', key: 'tiers' },
    { href: '/admin/loyalty/catalog', label: 'Catalog', key: 'catalog' },
    { href: '/admin/loyalty/redemptions', label: 'Redemptions', key: 'redemptions' },
    { href: '/admin/loyalty/liability', label: 'Liability', key: 'liability' },
  ]} />;
}

// Standard loading / empty / error placeholders for every list page.
export function StateBlock({ loading, error, empty, emptyText = 'No records found.', children }: PropsWithChildren<{ loading: boolean; error: string | null; empty: boolean; emptyText?: string }>) {
  if (loading) return <p style={{ color: colors.muted }}>Loading…</p>;
  if (error) return <p style={{ color: colors.danger }}>{error}</p>;
  if (empty) return <p style={{ color: colors.muted }}>{emptyText}</p>;
  return <>{children}</>;
}

// Disclosure banner — surfaces the platform invariants admins must respect
// (NL-3 closed-loop / residual refund, NL-4 points ≠ cash, NL-10 KYC gate).
export function DisclosureNote({ children }: PropsWithChildren) {
  return (
    <div style={{ border: `1px solid ${tint('#7c3aed', 0.4)}`, background: tint('#7c3aed', 0.08), color: '#5b21b6', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.78rem', marginBottom: '1rem' }}>
      {children}
    </div>
  );
}

// Inline note that a state-change action is recorded to the immutable audit log (NL-12).
export function AuditNote({ children }: PropsWithChildren) {
  return (
    <div style={{ border: `1px solid ${tint(colors.warning, 0.4)}`, background: tint(colors.warning, 0.1), color: colors.warning, borderRadius: '0.375rem', padding: '0.4rem 0.6rem', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.5rem' }}>
      <span aria-hidden style={{ fontWeight: 700 }}>●</span>
      <span>{children}</span>
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
