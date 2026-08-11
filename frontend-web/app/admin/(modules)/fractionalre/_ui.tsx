'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { colors, tint } from '@/components/ui/vuexy';

// Shared presentational helpers for the Fractional Real Estate console.
// Matches the Estate/Realtor console light-card inline-style convention.

export const card = (): CSSProperties => ({ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card, boxShadow: '0 4px 18px rgba(47, 43, 61, .06)' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: `1px solid ${colors.inputBorder}`, background: colors.card, cursor: 'pointer', fontSize: '0.85rem', color: colors.text });
export const btnPrimary = (bg = colors.primary): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: colors.muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: colors.text, fontSize: '0.85rem', borderTop: `1px solid ${colors.border}` });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.6rem', borderRadius: '0.375rem', border: `1px solid ${colors.inputBorder}`, fontSize: '0.85rem', width: '100%' });
export const label = (): CSSProperties => ({ fontSize: '0.78rem', fontWeight: 600, color: colors.text, display: 'block', marginBottom: 4 });

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  // green — healthy / done
  active: { fg: colors.success, bg: tint(colors.success, 0.12) }, verified: { fg: colors.success, bg: tint(colors.success, 0.12) }, completed: { fg: colors.success, bg: tint(colors.success, 0.12) },
  approved: { fg: colors.success, bg: tint(colors.success, 0.12) }, funded: { fg: colors.success, bg: tint(colors.success, 0.12) }, operational: { fg: colors.success, bg: tint(colors.success, 0.12) },
  allocated: { fg: colors.success, bg: tint(colors.success, 0.12) }, clear: { fg: colors.success, bg: tint(colors.success, 0.12) }, minmet: { fg: colors.success, bg: tint(colors.success, 0.12) },
  // amber — in progress / attention
  pending: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, underreview: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, titleverification: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  draft: { fg: colors.muted, bg: tint(colors.muted, 0.12) }, calculated: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, pendingapproval: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  closing: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, distributing: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, query: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  executing: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, refunding: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, medium: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  // red — bad / blocked
  rejected: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, halted: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, suspended: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  cancelled: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, expired: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, partiallyfailed: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  high: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, critical: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, breached: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  // blue / purple — neutral states
  fundingopen: { fg: colors.info, bg: tint(colors.info, 0.12) }, open: { fg: colors.info, bg: tint(colors.info, 0.12) }, low: { fg: colors.info, bg: tint(colors.info, 0.12) },
  primary: { fg: colors.info, bg: tint(colors.info, 0.12) }, secondary: { fg: colors.primary, bg: tint(colors.primary, 0.12) }, matched: { fg: colors.primary, bg: tint(colors.primary, 0.12) },
  retail: { fg: colors.info, bg: tint(colors.info, 0.12) }, qualified: { fg: colors.primary, bg: tint(colors.primary, 0.12) }, hni: { fg: colors.success, bg: tint(colors.success, 0.12) }, institutional: { fg: colors.primary, bg: tint(colors.primary, 0.12) },
};

export function Badge({ status, label: lbl }: { status: string; label?: string }) {
  const c = STATUS_COLORS[String(status).toLowerCase()] ?? { fg: colors.text, bg: tint(colors.muted, 0.12) };
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, textTransform: 'capitalize' }}>{lbl ?? String(status).replace(/_/g, ' ')}</span>;
}

export function Kpi({ label: lbl, value, accent, sub }: { label: string; value: string; accent?: string; sub?: string }) {
  return (
    <div style={{ ...card(), padding: '0.9rem 1rem', borderLeft: `3px solid ${accent ?? colors.border}` }}>
      <div style={{ fontSize: '0.75rem', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{lbl}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: 4, color: colors.text }}>{value}</div>
      {sub ? <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
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

// SoD / maker-checker advisory banner used across compliance/distribution/title pages.
export function SodNote({ children }: PropsWithChildren) {
  return (
    <div style={{ background: tint(colors.warning, 0.12), border: `1px solid ${tint(colors.warning, 0.4)}`, borderRadius: '0.5rem', padding: '0.6rem 0.85rem', fontSize: '0.8rem', color: colors.warning, marginBottom: '1rem' }}>
      <strong>Segregation of duties:</strong> {children}
    </div>
  );
}

export function FractionalReTabs({ active }: { active: string }) {
  const tabs = [
    { href: '/admin/fractionalre', label: 'Dashboard', key: 'dashboard' },
    { href: '/admin/fractionalre/assets', label: 'Assets', key: 'assets' },
    { href: '/admin/fractionalre/rounds', label: 'Rounds', key: 'rounds' },
    { href: '/admin/fractionalre/cap-table', label: 'Cap Table', key: 'cap-table' },
    { href: '/admin/fractionalre/investors', label: 'Investors', key: 'investors' },
    { href: '/admin/fractionalre/compliance', label: 'Compliance', key: 'compliance' },
    { href: '/admin/fractionalre/distributions', label: 'Distributions', key: 'distributions' },
    { href: '/admin/fractionalre/market', label: 'Market', key: 'market' },
    { href: '/admin/fractionalre/sponsors', label: 'Sponsors', key: 'sponsors' },
    { href: '/admin/fractionalre/finance', label: 'Finance', key: 'finance' },
    { href: '/admin/fractionalre/documents', label: 'Documents', key: 'documents' },
    { href: '/admin/fractionalre/audit', label: 'Audit', key: 'audit' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: `1px solid ${colors.border}`, paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : colors.text, background: active === t.key ? colors.primary : colors.headBg }}>{t.label}</Link>
      ))}
    </div>
  );
}

// Naira from kobo (integer minor units).
export function naira(kobo: number): string {
  return `₦${(((kobo ?? 0) / 100)).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function money(minorKobo: number): string {
  const n = (minorKobo ?? 0) / 100;
  const body = n >= 1_000_000_000 ? `${(n / 1_000_000_000).toFixed(2)}B` : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 10_000 ? `${(n / 1_000).toFixed(1)}K` : n.toLocaleString('en-NG', { maximumFractionDigits: 0 });
  return `₦${body}`;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const past = diff >= 0;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3_600_000);
  if (h < 1) return past ? 'just now' : 'soon';
  if (h < 24) return past ? `${h}h ago` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return past ? `${d}d ago` : `in ${d}d`;
}
