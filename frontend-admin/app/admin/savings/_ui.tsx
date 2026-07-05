'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';

// Shared presentational helpers for the Paymax Savings + Social Pay ops consoles.
// Matches the Connect / Insurance / Stays admin light-card inline-style convention
// (copied from stays/_ui.tsx). Both app/admin/savings/* and app/admin/social/*
// import from this single file via relative path.

export const card = (): CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (): CSSProperties => ({ ...btn(), border: '1px solid #340075', background: '#340075', color: '#fff', fontWeight: 600 });
export const btnDanger = (): CSSProperties => ({ ...btn(), border: '1px solid #b91c1c', background: '#fff', color: '#b91c1c', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: '#374151', fontSize: '0.85rem', borderTop: '1px solid #f3f4f6', verticalAlign: 'top' });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.55rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' });
export const label = (): CSSProperties => ({ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' });
export const select = (): CSSProperties => ({ ...input(), background: '#fff', cursor: 'pointer' });

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  // success / terminal-good
  active: { fg: '#15803d', bg: '#dcfce7' }, open: { fg: '#15803d', bg: '#dcfce7' },
  matured: { fg: '#15803d', bg: '#dcfce7' }, completed: { fg: '#15803d', bg: '#dcfce7' },
  settled: { fg: '#15803d', bg: '#dcfce7' }, reconciled: { fg: '#15803d', bg: '#dcfce7' },
  resolved: { fg: '#15803d', bg: '#dcfce7' }, paid: { fg: '#15803d', bg: '#dcfce7' },
  healthy: { fg: '#15803d', bg: '#dcfce7' }, approved: { fg: '#15803d', bg: '#dcfce7' },
  on_track: { fg: '#15803d', bg: '#dcfce7' }, recovered: { fg: '#15803d', bg: '#dcfce7' },
  cleared: { fg: '#15803d', bg: '#dcfce7' }, balanced: { fg: '#15803d', bg: '#dcfce7' },
  // pending / warn
  pending: { fg: '#9a3412', bg: '#ffedd5' }, forming: { fg: '#9a3412', bg: '#ffedd5' },
  scheduled: { fg: '#9a3412', bg: '#ffedd5' }, queued: { fg: '#9a3412', bg: '#ffedd5' },
  flagged: { fg: '#9a3412', bg: '#ffedd5' }, degraded: { fg: '#9a3412', bg: '#ffedd5' },
  at_risk: { fg: '#9a3412', bg: '#ffedd5' }, locked: { fg: '#9a3412', bg: '#ffedd5' },
  grace: { fg: '#9a3412', bg: '#ffedd5' }, review: { fg: '#9a3412', bg: '#ffedd5' },
  under_review: { fg: '#9a3412', bg: '#ffedd5' }, late: { fg: '#9a3412', bg: '#ffedd5' },
  // in-progress / info (blue)
  investigating: { fg: '#1d4ed8', bg: '#dbeafe' }, processing: { fg: '#1d4ed8', bg: '#dbeafe' },
  collecting: { fg: '#1d4ed8', bg: '#dbeafe' }, flex: { fg: '#1d4ed8', bg: '#dbeafe' },
  normal: { fg: '#1d4ed8', bg: '#dbeafe' }, invited: { fg: '#1d4ed8', bg: '#dbeafe' },
  // neutral / muted
  draft: { fg: '#6b7280', bg: '#f3f4f6' }, expired: { fg: '#6b7280', bg: '#f3f4f6' },
  closed: { fg: '#6b7280', bg: '#f3f4f6' }, ignored: { fg: '#6b7280', bg: '#f3f4f6' },
  exited: { fg: '#6b7280', bg: '#f3f4f6' }, low: { fg: '#6b7280', bg: '#f3f4f6' },
  disabled: { fg: '#6b7280', bg: '#f3f4f6' }, dismissed: { fg: '#6b7280', bg: '#f3f4f6' },
  // danger / terminal-bad
  rejected: { fg: '#b91c1c', bg: '#fee2e2' }, failed: { fg: '#b91c1c', bg: '#fee2e2' },
  defaulted: { fg: '#b91c1c', bg: '#fee2e2' }, blocked: { fg: '#b91c1c', bg: '#fee2e2' },
  high: { fg: '#b91c1c', bg: '#fee2e2' }, critical: { fg: '#b91c1c', bg: '#fee2e2' },
  breached: { fg: '#b91c1c', bg: '#fee2e2' }, suspended: { fg: '#b91c1c', bg: '#fee2e2' },
  impersonation: { fg: '#b91c1c', bg: '#fee2e2' }, abuse: { fg: '#b91c1c', bg: '#fee2e2' },
  // refund / reversal (purple)
  refunded: { fg: '#7c3aed', bg: '#ede9fe' }, reversed: { fg: '#7c3aed', bg: '#ede9fe' },
  reversal: { fg: '#7c3aed', bg: '#ede9fe' }, make_good: { fg: '#7c3aed', bg: '#ede9fe' },
  // severity / grade
  medium: { fg: '#9a3412', bg: '#ffedd5' },
  // ledger kinds
  CREDIT: { fg: '#15803d', bg: '#dcfce7' }, DEBIT: { fg: '#9a3412', bg: '#ffedd5' },
  HOLD: { fg: '#9a3412', bg: '#ffedd5' }, RELEASE: { fg: '#6b7280', bg: '#f3f4f6' },
  PAYOUT: { fg: '#1d4ed8', bg: '#dbeafe' }, CONTRIBUTION: { fg: '#15803d', bg: '#dcfce7' },
  // dispute / cashtag kinds
  payment: { fg: '#1d4ed8', bg: '#dbeafe' }, request: { fg: '#7c3aed', bg: '#ede9fe' },
  split: { fg: '#1d4ed8', bg: '#dbeafe' }, pool: { fg: '#7c3aed', bg: '#ede9fe' },
  reserved: { fg: '#6b7280', bg: '#f3f4f6' }, verified: { fg: '#15803d', bg: '#dcfce7' },
};

export function Badge({ status, label: lbl }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status] ?? { fg: '#374151', bg: '#f3f4f6' };
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
