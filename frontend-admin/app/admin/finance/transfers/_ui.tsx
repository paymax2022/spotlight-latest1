'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';

// Shared presentational + RBAC helpers for the Transfers console. Matches the
// existing admin light-card inline-style convention (connect/_ui, mobility/_ui).

export const card = (): CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (bg = '#1d4ed8'): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 });
export const btnDisabled = (): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: '1px solid #e5e7eb', background: '#f3f4f6', color: '#9ca3af', cursor: 'not-allowed', fontSize: '0.85rem', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: '#374151', fontSize: '0.85rem', borderTop: '1px solid #f3f4f6' });
export const selectStyle = (): CSSProperties => ({ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' });

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{title}</h1>
        {subtitle ? <p style={{ color: '#6b7280', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>{subtitle}</p> : null}
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
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>{title}</h2>
          {right}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function BackLink() {
  return (
    <Link href="/admin/finance/transfers" style={{ color: '#1d4ed8', textDecoration: 'none', fontSize: '0.85rem' }}>
      ← Back to transfers
    </Link>
  );
}

// RBAC: reads the cached admin user and exposes a permission check so we can
// disable sensitive money actions. Server still enforces — UX gate only.
const TRANSFERS_PERM = 'finance.admin.transfers';

export function useTransfersPermissions() {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setUser(JSON.parse(raw) as AuthUser);
    } catch { /* unauthenticated handled by route guard */ }
  }, []);
  const canManage = hasAnyPermission(user, [TRANSFERS_PERM]);
  return { user, canManage, permission: TRANSFERS_PERM };
}
