'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';
import { colors, tint } from '@/components/ui/vuexy';

// Shared presentational + RBAC helpers for the Paymax Crypto admin console.
// Matches the marketplace/savings/_ui.tsx light-card inline-style convention.
// Backend RBAC (guard("crypto.admin")) is authoritative — everything here is a
// UX-only gate.

export const card = (): CSSProperties => ({ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: `1px solid ${colors.inputBorder}`, background: colors.card, cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: 'none', background: colors.primary, color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 });
export const btnDisabled = (): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: `1px solid ${colors.border}`, background: colors.bg, color: colors.muted, cursor: 'not-allowed', fontSize: '0.85rem', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: colors.muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: colors.text, fontSize: '0.85rem', borderTop: `1px solid ${colors.border}`, verticalAlign: 'top' });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' });
export const label = (): CSSProperties => ({ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' });
export const select = (): CSSProperties => ({ ...input(), background: colors.card, cursor: 'pointer' });
export const textarea = (): CSSProperties => ({ ...input(), minHeight: '4rem', fontFamily: 'inherit', resize: 'vertical' });
export const mono = (): CSSProperties => ({ fontFamily: 'monospace', fontSize: '0.8rem' });

type Tab = { href: string; label: string; key: string };

export function CryptoTabs({ active }: { active: string }) {
  const tabs: Tab[] = [
    { href: '/admin/crypto', label: 'Overview', key: 'overview' },
    { href: '/admin/crypto/orders', label: 'Orders', key: 'orders' },
    { href: '/admin/crypto/withdrawals', label: 'Withdrawals / AML', key: 'withdrawals' },
    { href: '/admin/crypto/swaps', label: 'Swaps', key: 'swaps' },
    { href: '/admin/crypto/addresses', label: 'Address review', key: 'addresses' },
    { href: '/admin/crypto/reconciliation', label: 'Reconciliation', key: 'reconciliation' },
    { href: '/admin/crypto/assets', label: 'Assets', key: 'assets' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: `1px solid ${colors.border}`, paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : colors.text, background: active === t.key ? colors.primary : colors.bg }}>{t.label}</Link>
      ))}
    </div>
  );
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

// Standard loading / empty / error placeholders for every list page.
export function StateBlock({ loading, error, empty, emptyText = 'No records found.', children }: PropsWithChildren<{ loading: boolean; error: string | null; empty: boolean; emptyText?: string }>) {
  if (loading) return <p style={{ color: colors.muted }}>Loading…</p>;
  if (error) return <p style={{ color: colors.danger }}>{error}</p>;
  if (empty) return <p style={{ color: colors.muted }}>{emptyText}</p>;
  return <>{children}</>;
}

// Disclosure banner — surfaces the platform invariants operators must respect.
export function DisclosureNote({ children }: PropsWithChildren) {
  return (
    <div style={{ border: `1px solid ${tint(colors.primary, 0.35)}`, background: tint(colors.primary, 0.08), color: colors.primary, borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.78rem', marginBottom: '1rem' }}>
      {children}
    </div>
  );
}

// Inline note that a state-change action is recorded to the immutable audit log.
export function AuditNote({ children }: PropsWithChildren) {
  return (
    <div style={{ border: `1px solid ${tint(colors.warning, 0.4)}`, background: tint(colors.warning, 0.1), color: colors.warning, borderRadius: '0.375rem', padding: '0.4rem 0.6rem', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.5rem' }}>
      <span aria-hidden style={{ fontWeight: 700 }}>●</span>
      <span>{children ?? 'Every mutating action here is subject to the ledger money-mutation invariants (idempotency key, balanced entries, audit event, fail-closed tier limits).'}</span>
    </div>
  );
}

// Red banner: caller lacks the console's permission — reads allowed, writes gated.
export function PermissionBanner({ permission }: { permission: string }) {
  return (
    <div style={{ background: tint(colors.danger, 0.08), border: `1px solid ${tint(colors.danger, 0.4)}`, borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: colors.danger, marginBottom: '1.25rem' }}>
      You lack <code>{permission}</code>. You can view this console but actions are disabled. Backend RBAC is authoritative.
    </div>
  );
}

// Inline filter bar wrapper.
export function FilterBar({ children }: PropsWithChildren) {
  return <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>{children}</div>;
}

export function fmtDate(isoStr: string | null | undefined): string {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Render integer asset minor-units as a decimal whole-unit string using the
// asset's minor_unit_scale. NEVER used for money — money is formatKobo() only.
// Integer division keeps the whole part exact; the fractional part is derived by
// remainder, so no float rounding touches the ledger-critical integer value.
export function fmtUnits(units: number, minorUnitScale: number, symbol?: string): string {
  if (!minorUnitScale || minorUnitScale <= 0) return `${units.toLocaleString('en-NG')}${symbol ? ` ${symbol}` : ''}`;
  const sign = units < 0 ? '-' : '';
  const abs = Math.abs(units);
  const whole = Math.floor(abs / minorUnitScale);
  const frac = abs % minorUnitScale;
  const digits = String(minorUnitScale).length - 1;
  const fracStr = digits > 0 ? '.' + String(frac).padStart(digits, '0').replace(/0+$/, '') : '';
  const cleanFrac = fracStr === '.' ? '' : fracStr;
  return `${sign}${whole.toLocaleString('en-NG')}${cleanFrac}${symbol ? ` ${symbol}` : ''}`;
}

// AML/risk score chip: green (<40), amber (40-69), red (>=70).
export function RiskBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <span style={{ color: colors.muted }}>—</span>;
  const c = score >= 70 ? { fg: colors.danger, bg: tint(colors.danger, 0.12) } : score >= 40 ? { fg: colors.warning, bg: tint(colors.warning, 0.12) } : { fg: colors.success, bg: tint(colors.success, 0.12) };
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 700, color: c.fg, background: c.bg }}>{score}</span>;
}

// Small flag pill for AML flags / screening tags.
export function FlagPill({ children }: PropsWithChildren) {
  return <span style={{ display: 'inline-block', padding: '0.05rem 0.4rem', borderRadius: '0.25rem', fontSize: '0.68rem', fontWeight: 600, color: colors.warning, background: tint(colors.warning, 0.1), border: `1px solid ${tint(colors.warning, 0.4)}`, marginRight: '0.25rem', marginBottom: '0.15rem', whiteSpace: 'nowrap' }}>{children}</span>;
}

// ── Badges ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  filled: { fg: colors.success, bg: tint(colors.success, 0.12) },
  active: { fg: colors.success, bg: tint(colors.success, 0.12) },
  pending: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  failed: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  reversed: { fg: colors.primary, bg: tint(colors.primary, 0.12) },
  inactive: { fg: colors.muted, bg: tint(colors.secondary, 0.12) },
  buy: { fg: colors.success, bg: tint(colors.success, 0.12) },
  sell: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  // withdrawal state machine
  requested: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  broadcast: { fg: colors.info, bg: tint(colors.info, 0.12) },
  confirmed: { fg: colors.success, bg: tint(colors.success, 0.12) },
  // address / recon review
  approved: { fg: colors.success, bg: tint(colors.success, 0.12) },
  rejected: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  ok: { fg: colors.success, bg: tint(colors.success, 0.12) },
  break: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
};

export function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? { fg: colors.text, bg: tint(colors.secondary, 0.12) };
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{String(status).replace(/_/g, ' ')}</span>;
}

// ── RBAC ──────────────────────────────────────────────────────────────────
// Per-console permission — MUST match backend/internal/crypto/model.go
// PermAdmin = "crypto.admin". Server RBAC (guard("crypto.admin")) remains
// authoritative — this is a UX gate only.
export const CRYPTO_PERMS = {
  admin: 'crypto.admin',
} as const;

export function useCryptoUser(): AuthUser | null {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setUser(JSON.parse(raw) as AuthUser);
    } catch { /* unauthenticated handled by route guard */ }
  }, []);
  return user;
}

// Returns whether the caller holds ANY of the given permissions (UX gate).
export function useCryptoPermission(...permissions: string[]) {
  const user = useCryptoUser();
  const allowed = hasAnyPermission(user, permissions);
  return { user, allowed, permission: permissions[0] };
}
