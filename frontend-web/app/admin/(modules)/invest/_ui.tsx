'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { colors, tint } from '@/components/ui/vuexy';

export const card = (): CSSProperties => ({ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: `1px solid ${colors.inputBorder}`, background: colors.card, cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (bg = colors.primary): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: colors.muted, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.02em' });
export const td = (): CSSProperties => ({ padding: '0.5rem 0.5rem', color: colors.text, borderTop: `1px solid ${colors.border}` });

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  Settled: { bg: tint(colors.success, 0.12), fg: colors.success },
  Filled: { bg: tint(colors.success, 0.12), fg: colors.success },
  PendingSettlement: { bg: tint(colors.warning, 0.12), fg: colors.warning },
  Accepted: { bg: tint(colors.info, 0.12), fg: colors.info },
  Submitted: { bg: tint(colors.info, 0.12), fg: colors.info },
  Failed: { bg: tint(colors.danger, 0.12), fg: colors.danger },
  Rejected: { bg: tint(colors.danger, 0.12), fg: colors.danger },
  Cancelled: { bg: tint(colors.secondary, 0.12), fg: colors.secondary },
  active: { bg: tint(colors.success, 0.12), fg: colors.success },
  suspended: { bg: tint(colors.warning, 0.12), fg: colors.warning },
  delisted: { bg: tint(colors.danger, 0.12), fg: colors.danger },
};

export function Badge({ status, label }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status] ?? { bg: tint(colors.secondary, 0.12), fg: colors.secondary };
  return (
    <span style={{ display: 'inline-block', padding: '0.15rem 0.55rem', borderRadius: 9999, background: c.bg, color: c.fg, fontSize: '0.75rem', fontWeight: 600 }}>
      {label ?? status}
    </span>
  );
}

export function Kpi({ label, value, accent, sub }: { label: string; value: string; accent?: string; sub?: string }) {
  return (
    <div style={card()}>
      <div style={{ fontSize: '0.78rem', color: colors.muted }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700, color: accent ?? colors.text, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1rem' }}>
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: colors.text }}>{title}</h1>
        {subtitle && <p style={{ color: colors.muted, fontSize: '0.88rem', marginTop: 2 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ title, children, right }: PropsWithChildren<{ title?: string; right?: ReactNode }>) {
  return (
    <div style={card()}>
      {(title || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          {title && <strong style={{ fontSize: '0.95rem' }}>{title}</strong>}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

const TABS: { label: string; href: string }[] = [
  { label: 'Overview', href: '/admin/invest' },
  { label: 'Assets', href: '/admin/invest/assets' },
  { label: 'Orders', href: '/admin/invest/orders' },
  { label: 'Settlement', href: '/admin/invest/settlement' },
  { label: 'Reconciliation', href: '/admin/invest/reconciliation' },
  { label: 'Corp Actions', href: '/admin/invest/corporate-actions' },
  { label: 'Providers', href: '/admin/invest/providers' },
  { label: 'Fees & Limits', href: '/admin/invest/fees' },
  { label: 'Audit', href: '/admin/invest/audit' },
];

export function InvestTabs() {
  const pathname = usePathname();
  return (
    <div style={{ display: 'flex', gap: '0.25rem', borderBottom: `1px solid ${colors.border}`, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            style={{
              padding: '0.5rem 0.85rem', fontSize: '0.85rem', textDecoration: 'none',
              color: active ? colors.primary : colors.muted, fontWeight: active ? 700 : 500,
              borderBottom: active ? `2px solid ${colors.primary}` : '2px solid transparent', marginBottom: -1,
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

// Naira from kobo (integer minor units).
export function naira(kobo: number): string {
  return `₦${(((kobo ?? 0) / 100)).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
