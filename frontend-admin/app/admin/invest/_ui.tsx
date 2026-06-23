'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';

export const card = (): CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (bg = '#340075'): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: '#6b7280', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.02em' });
export const td = (): CSSProperties => ({ padding: '0.5rem 0.5rem', color: '#374151', borderTop: '1px solid #f3f4f6' });

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  Settled: { bg: '#dcfce7', fg: '#166534' },
  Filled: { bg: '#dcfce7', fg: '#166534' },
  PendingSettlement: { bg: '#fef3c7', fg: '#92400e' },
  Accepted: { bg: '#e0e7ff', fg: '#3730a3' },
  Submitted: { bg: '#e0e7ff', fg: '#3730a3' },
  Failed: { bg: '#fee2e2', fg: '#991b1b' },
  Rejected: { bg: '#fee2e2', fg: '#991b1b' },
  Cancelled: { bg: '#f3f4f6', fg: '#374151' },
  active: { bg: '#dcfce7', fg: '#166534' },
  suspended: { bg: '#fef3c7', fg: '#92400e' },
  delisted: { bg: '#fee2e2', fg: '#991b1b' },
};

export function Badge({ status, label }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status] ?? { bg: '#f3f4f6', fg: '#374151' };
  return (
    <span style={{ display: 'inline-block', padding: '0.15rem 0.55rem', borderRadius: 9999, background: c.bg, color: c.fg, fontSize: '0.75rem', fontWeight: 600 }}>
      {label ?? status}
    </span>
  );
}

export function Kpi({ label, value, accent, sub }: { label: string; value: string; accent?: string; sub?: string }) {
  return (
    <div style={card()}>
      <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700, color: accent ?? '#111827', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1rem' }}>
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#111827' }}>{title}</h1>
        {subtitle && <p style={{ color: '#6b7280', fontSize: '0.88rem', marginTop: 2 }}>{subtitle}</p>}
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
  { label: 'Fees & Limits', href: '/admin/invest/fees' },
  { label: 'Audit', href: '/admin/invest/audit' },
];

export function InvestTabs() {
  const pathname = usePathname();
  return (
    <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid #e5e7eb', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            style={{
              padding: '0.5rem 0.85rem', fontSize: '0.85rem', textDecoration: 'none',
              color: active ? '#340075' : '#6b7280', fontWeight: active ? 700 : 500,
              borderBottom: active ? '2px solid #340075' : '2px solid transparent', marginBottom: -1,
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
