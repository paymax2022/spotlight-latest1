'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { colors } from '@/components/ui/vuexy';

// Shared presentational helpers for the Paymax Top-5 Phase-3 admin consoles:
//   • Creators  (app/admin/creators/*)
//   • Social Escrow / dispute arbitration (app/admin/social-escrow/*)
//   • Paymax Black + partners (app/admin/loyalty-black/*)
// Copied from app/admin/events/_ui.tsx (light-card inline-style convention shared
// across Connect / Insurance / Stays / Savings / Events admin). All three page
// trees import from this single file.

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
  active: { fg: '#15803d', bg: '#dcfce7' }, approved: { fg: '#15803d', bg: '#dcfce7' },
  live: { fg: '#15803d', bg: '#dcfce7' }, completed: { fg: '#15803d', bg: '#dcfce7' },
  settled: { fg: '#15803d', bg: '#dcfce7' }, reconciled: { fg: '#15803d', bg: '#dcfce7' },
  resolved: { fg: '#15803d', bg: '#dcfce7' }, paid: { fg: '#15803d', bg: '#dcfce7' },
  healthy: { fg: '#15803d', bg: '#dcfce7' }, released: { fg: '#15803d', bg: '#dcfce7' },
  cleared: { fg: '#15803d', bg: '#dcfce7' }, balanced: { fg: '#15803d', bg: '#dcfce7' },
  kyc_verified: { fg: '#15803d', bg: '#dcfce7' }, published: { fg: '#15803d', bg: '#dcfce7' },
  redeemed: { fg: '#15803d', bg: '#dcfce7' }, resolved_release: { fg: '#15803d', bg: '#dcfce7' },
  // pending / warn
  pending: { fg: '#9a3412', bg: '#ffedd5' }, submitted: { fg: '#9a3412', bg: '#ffedd5' },
  scheduled: { fg: '#9a3412', bg: '#ffedd5' }, queued: { fg: '#9a3412', bg: '#ffedd5' },
  flagged: { fg: '#9a3412', bg: '#ffedd5' }, paused: { fg: '#9a3412', bg: '#ffedd5' },
  kyc_hold: { fg: '#9a3412', bg: '#ffedd5' }, past_due: { fg: '#9a3412', bg: '#ffedd5' },
  awaiting_evidence: { fg: '#9a3412', bg: '#ffedd5' }, issued: { fg: '#9a3412', bg: '#ffedd5' },
  // in-progress / info (blue)
  investigating: { fg: '#1d4ed8', bg: '#dbeafe' }, processing: { fg: '#1d4ed8', bg: '#dbeafe' },
  open: { fg: '#1d4ed8', bg: '#dbeafe' }, normal: { fg: '#1d4ed8', bg: '#dbeafe' },
  in_review: { fg: '#1d4ed8', bg: '#dbeafe' }, held: { fg: '#1d4ed8', bg: '#dbeafe' },
  // neutral / muted
  draft: { fg: '#6b7280', bg: '#f3f4f6' }, expired: { fg: '#6b7280', bg: '#f3f4f6' },
  closed: { fg: '#6b7280', bg: '#f3f4f6' }, ignored: { fg: '#6b7280', bg: '#f3f4f6' },
  ended: { fg: '#6b7280', bg: '#f3f4f6' }, low: { fg: '#6b7280', bg: '#f3f4f6' },
  disabled: { fg: '#6b7280', bg: '#f3f4f6' }, dismissed: { fg: '#6b7280', bg: '#f3f4f6' },
  cancelled: { fg: '#6b7280', bg: '#f3f4f6' }, revoked: { fg: '#6b7280', bg: '#f3f4f6' },
  // danger / terminal-bad
  rejected: { fg: '#b91c1c', bg: '#fee2e2' }, failed: { fg: '#b91c1c', bg: '#fee2e2' },
  blocked: { fg: '#b91c1c', bg: '#fee2e2' }, suspended: { fg: '#b91c1c', bg: '#fee2e2' },
  high: { fg: '#b91c1c', bg: '#fee2e2' }, critical: { fg: '#b91c1c', bg: '#fee2e2' },
  breached: { fg: '#b91c1c', bg: '#fee2e2' },
  // refund / reversal (purple)
  refunded: { fg: '#7c3aed', bg: '#ede9fe' }, reversed: { fg: '#7c3aed', bg: '#ede9fe' },
  disputed: { fg: '#7c3aed', bg: '#ede9fe' }, resolved_refund: { fg: '#7c3aed', bg: '#ede9fe' },
  // severity / grade
  medium: { fg: '#9a3412', bg: '#ffedd5' },
  // KYC tiers
  tier0: { fg: '#b91c1c', bg: '#fee2e2' }, tier1: { fg: '#9a3412', bg: '#ffedd5' },
  tier2: { fg: '#1d4ed8', bg: '#dbeafe' }, tier3: { fg: '#15803d', bg: '#dcfce7' },
  // age ratings (NL-11)
  all: { fg: '#15803d', bg: '#dcfce7' }, teen: { fg: '#9a3412', bg: '#ffedd5' },
  mature_18: { fg: '#b91c1c', bg: '#fee2e2' },
  // perk kinds
  early_ticket: { fg: '#7c3aed', bg: '#ede9fe' }, lounge_access: { fg: '#0e7490', bg: '#cffafe' },
  discount: { fg: '#1d4ed8', bg: '#dbeafe' }, priority_support: { fg: '#15803d', bg: '#dcfce7' },
  partner_offer: { fg: '#9a3412', bg: '#ffedd5' }, free_delivery: { fg: '#0e7490', bg: '#cffafe' },
  // settlement models
  platform_funded: { fg: '#1d4ed8', bg: '#dbeafe' }, partner_funded: { fg: '#7c3aed', bg: '#ede9fe' },
  shared: { fg: '#9a3412', bg: '#ffedd5' },
  // fraud kinds
  self_tip: { fg: '#b91c1c', bg: '#fee2e2' }, tip_wash: { fg: '#7c3aed', bg: '#ede9fe' },
  sub_churn_abuse: { fg: '#9a3412', bg: '#ffedd5' }, chargeback_ring: { fg: '#b91c1c', bg: '#fee2e2' },
  content_recycle: { fg: '#6b7280', bg: '#f3f4f6' }, mule_account: { fg: '#b91c1c', bg: '#fee2e2' },
  structuring: { fg: '#b91c1c', bg: '#fee2e2' }, collusive_dispute: { fg: '#9a3412', bg: '#ffedd5' },
  rapid_release: { fg: '#7c3aed', bg: '#ede9fe' }, aml_threshold: { fg: '#b91c1c', bg: '#fee2e2' },
  // billing cycles + misc kinds (activity badges)
  monthly: { fg: '#1d4ed8', bg: '#dbeafe' }, quarterly: { fg: '#9a3412', bg: '#ffedd5' },
  annual: { fg: '#15803d', bg: '#dcfce7' },
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

export function CreatorsTabs({ active }: { active: string }) {
  return <Tabs active={active} tabs={[
    { href: '/admin/creators/dashboard', label: 'Overview', key: 'overview' },
    { href: '/admin/creators/verification', label: 'Verification', key: 'verification' },
    { href: '/admin/creators/moderation', label: 'Moderation', key: 'moderation' },
    { href: '/admin/creators/billing', label: 'Billing', key: 'billing' },
    { href: '/admin/creators/payouts', label: 'Payouts', key: 'payouts' },
    { href: '/admin/creators/fees', label: 'Fees', key: 'fees' },
    { href: '/admin/creators/fraud', label: 'Fraud', key: 'fraud' },
  ]} />;
}

export function EscrowTabs({ active }: { active: string }) {
  return <Tabs active={active} tabs={[
    { href: '/admin/social-escrow/dashboard', label: 'Overview', key: 'overview' },
    { href: '/admin/social-escrow/disputes', label: 'Disputes', key: 'disputes' },
    { href: '/admin/social-escrow/fraud', label: 'Fraud / AML', key: 'fraud' },
  ]} />;
}

export function BlackTabs({ active }: { active: string }) {
  return <Tabs active={active} tabs={[
    { href: '/admin/loyalty-black/dashboard', label: 'Overview', key: 'overview' },
    { href: '/admin/loyalty-black/perks', label: 'Perks', key: 'perks' },
    { href: '/admin/loyalty-black/partners', label: 'Partners', key: 'partners' },
    { href: '/admin/loyalty-black/settlement', label: 'Settlement', key: 'settlement' },
  ]} />;
}

// Standard loading / empty / error placeholders for every list page.
export function StateBlock({ loading, error, empty, emptyText = 'No records found.', children }: PropsWithChildren<{ loading: boolean; error: string | null; empty: boolean; emptyText?: string }>) {
  if (loading) return <p style={{ color: '#6b7280' }}>Loading…</p>;
  if (error) return <p style={{ color: '#dc2626' }}>{error}</p>;
  if (empty) return <p style={{ color: '#6b7280' }}>{emptyText}</p>;
  return <>{children}</>;
}

// Disclosure banner — surfaces the platform invariants admins must respect
// (NL-5 perks-not-returns, NL-6 escrow holds-not-lends, NL-10 KYC gate,
//  NL-11 content & age safety).
export function DisclosureNote({ children }: PropsWithChildren) {
  return (
    <div style={{ border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#5b21b6', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.78rem', marginBottom: '1rem' }}>
      {children}
    </div>
  );
}

// Inline note that a state-change action is recorded to the immutable audit log (NL-12).
export function AuditNote({ children }: PropsWithChildren) {
  return (
    <div style={{ border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e', borderRadius: '0.375rem', padding: '0.4rem 0.6rem', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.5rem' }}>
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

export function bps(n: number): string {
  return `${n} bps (${(n / 100).toFixed(2)}%)`;
}
