'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { colors, tint } from '@/components/ui/vuexy';

// Shared presentational helpers for the Paymax Savings + Social Pay ops consoles.
// Matches the Vuexy light-theme kit (see @/components/ui/vuexy, app/admin/roles/page.tsx).
// Both app/admin/savings/* and app/admin/social/* import from this single file via
// relative path.

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
  active: { fg: colors.success, bg: tint(colors.success, 0.12) }, open: { fg: colors.success, bg: tint(colors.success, 0.12) },
  matured: { fg: colors.success, bg: tint(colors.success, 0.12) }, completed: { fg: colors.success, bg: tint(colors.success, 0.12) },
  settled: { fg: colors.success, bg: tint(colors.success, 0.12) }, reconciled: { fg: colors.success, bg: tint(colors.success, 0.12) },
  resolved: { fg: colors.success, bg: tint(colors.success, 0.12) }, paid: { fg: colors.success, bg: tint(colors.success, 0.12) },
  healthy: { fg: colors.success, bg: tint(colors.success, 0.12) }, approved: { fg: colors.success, bg: tint(colors.success, 0.12) },
  on_track: { fg: colors.success, bg: tint(colors.success, 0.12) }, recovered: { fg: colors.success, bg: tint(colors.success, 0.12) },
  cleared: { fg: colors.success, bg: tint(colors.success, 0.12) }, balanced: { fg: colors.success, bg: tint(colors.success, 0.12) },
  // pending / warn
  pending: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, forming: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  scheduled: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, queued: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  flagged: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, degraded: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  at_risk: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, locked: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  grace: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, review: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  under_review: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, late: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  // in-progress / info (blue)
  investigating: { fg: colors.info, bg: tint(colors.info, 0.12) }, processing: { fg: colors.info, bg: tint(colors.info, 0.12) },
  collecting: { fg: colors.info, bg: tint(colors.info, 0.12) }, flex: { fg: colors.info, bg: tint(colors.info, 0.12) },
  normal: { fg: colors.info, bg: tint(colors.info, 0.12) }, invited: { fg: colors.info, bg: tint(colors.info, 0.12) },
  // neutral / muted
  draft: { fg: colors.muted, bg: colors.bg }, expired: { fg: colors.muted, bg: colors.bg },
  closed: { fg: colors.muted, bg: colors.bg }, ignored: { fg: colors.muted, bg: colors.bg },
  exited: { fg: colors.muted, bg: colors.bg }, low: { fg: colors.muted, bg: colors.bg },
  disabled: { fg: colors.muted, bg: colors.bg }, dismissed: { fg: colors.muted, bg: colors.bg },
  // danger / terminal-bad
  rejected: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, failed: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  defaulted: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, blocked: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  high: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, critical: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  breached: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, suspended: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  impersonation: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, abuse: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  // refund / reversal (purple)
  refunded: { fg: colors.primary, bg: tint(colors.primary, 0.12) }, reversed: { fg: colors.primary, bg: tint(colors.primary, 0.12) },
  reversal: { fg: colors.primary, bg: tint(colors.primary, 0.12) }, make_good: { fg: colors.primary, bg: tint(colors.primary, 0.12) },
  // severity / grade
  medium: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  // ledger kinds
  CREDIT: { fg: colors.success, bg: tint(colors.success, 0.12) }, DEBIT: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  HOLD: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, RELEASE: { fg: colors.muted, bg: colors.bg },
  PAYOUT: { fg: colors.info, bg: tint(colors.info, 0.12) }, CONTRIBUTION: { fg: colors.success, bg: tint(colors.success, 0.12) },
  // dispute / cashtag kinds
  payment: { fg: colors.info, bg: tint(colors.info, 0.12) }, request: { fg: colors.primary, bg: tint(colors.primary, 0.12) },
  split: { fg: colors.info, bg: tint(colors.info, 0.12) }, pool: { fg: colors.primary, bg: tint(colors.primary, 0.12) },
  reserved: { fg: colors.muted, bg: colors.bg }, verified: { fg: colors.success, bg: tint(colors.success, 0.12) },
};

export function Badge({ status, label: lbl }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status] ?? { fg: colors.text, bg: colors.bg };
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{lbl ?? status.replace(/_/g, ' ')}</span>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: colors.text }}>{title}</h1>
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
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: colors.text }}>{title}</h2>
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
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : colors.text, background: active === t.key ? colors.primary : colors.bg }}>{t.label}</Link>
      ))}
    </div>
  );
}

export function SavingsTabs({ active }: { active: string }) {
  return <Tabs active={active} tabs={[
    { href: '/admin/savings/dashboard', label: 'Overview', key: 'overview' },
    { href: '/admin/savings/vaults', label: 'Vaults', key: 'vaults' },
    { href: '/admin/savings/float-recon', label: 'Float recon', key: 'float' },
    { href: '/admin/savings/ajo', label: 'Ajo circles', key: 'ajo' },
    { href: '/admin/savings/defaults', label: 'Defaults', key: 'defaults' },
  ]} />;
}

export function SocialTabs({ active }: { active: string }) {
  return <Tabs active={active} tabs={[
    { href: '/admin/social/dashboard', label: 'Overview', key: 'overview' },
    { href: '/admin/social/limits', label: 'Limits', key: 'limits' },
    { href: '/admin/social/reversals', label: 'Reversals', key: 'reversals' },
    { href: '/admin/social/disputes', label: 'Disputes', key: 'disputes' },
    { href: '/admin/social/cashtags', label: 'Cashtags', key: 'cashtags' },
  ]} />;
}

// Standard loading / empty / error placeholders for every list page.
export function StateBlock({ loading, error, empty, emptyText = 'No records found.', children }: PropsWithChildren<{ loading: boolean; error: string | null; empty: boolean; emptyText?: string }>) {
  if (loading) return <p style={{ color: '#6b7280' }}>Loading…</p>;
  if (error) return <p style={{ color: '#dc2626' }}>{error}</p>;
  if (empty) return <p style={{ color: '#6b7280' }}>{emptyText}</p>;
  return <>{children}</>;
}

// Disclosure banner — surfaces the platform invariants that admins must respect.
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
