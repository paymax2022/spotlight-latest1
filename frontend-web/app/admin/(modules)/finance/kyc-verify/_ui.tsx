'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';
import type { CheckStatus, SessionStatus } from '@/types/kycAdmin';

// Shared presentational + RBAC helpers for the KYC Verification console.
// Matches the existing admin light-card inline-style convention (transfers/_ui).

export const card = (): CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (bg = '#1d4ed8'): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 });
export const btnDisabled = (): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: '1px solid #e5e7eb', background: '#f3f4f6', color: '#9ca3af', cursor: 'not-allowed', fontSize: '0.85rem', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: '#374151', fontSize: '0.85rem', borderTop: '1px solid #f3f4f6' });
export const selectStyle = (): CSSProperties => ({ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem' });
export const inputStyle = (): CSSProperties => ({ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', boxSizing: 'border-box' });

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

// Amber banner used to flag scaffolded (not-yet-wired-to-real-actions) screens.
export function ScaffoldNotice({ children }: PropsWithChildren) {
  return (
    <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#9a3412', marginBottom: '1.25rem' }}>
      <strong>Scaffold.</strong> {children}
    </div>
  );
}

export function timeAgo(isoStr?: string | null): string {
  if (!isoStr) return '—';
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function BackToQueue() {
  return (
    <Link href="/admin/finance/kyc-verify" style={{ color: '#1d4ed8', textDecoration: 'none', fontSize: '0.85rem' }}>
      ← Back to review queue
    </Link>
  );
}

// ── Badges ──────────────────────────────────────────────────────────────────

const CHECK_STATUS_COLORS: Record<CheckStatus, { fg: string; bg: string }> = {
  PASSED:    { fg: '#15803d', bg: '#dcfce7' }, // green
  FAILED:    { fg: '#b91c1c', bg: '#fee2e2' }, // red
  REVIEW:    { fg: '#9a3412', bg: '#ffedd5' }, // amber (needs review)
  PENDING:   { fg: '#1d4ed8', bg: '#dbeafe' }, // blue (in-flight)
  INITIATED: { fg: '#374151', bg: '#f3f4f6' }, // grey
};

export function CheckStatusBadge({ status }: { status: CheckStatus }) {
  const c = CHECK_STATUS_COLORS[status] ?? { fg: '#374151', bg: '#f3f4f6' };
  return (
    <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg }}>
      {status}
    </span>
  );
}

const SESSION_STATUS_COLORS: Record<SessionStatus, { fg: string; bg: string }> = {
  APPROVED:     { fg: '#15803d', bg: '#dcfce7' },
  REJECTED:     { fg: '#b91c1c', bg: '#fee2e2' },
  NEEDS_REVIEW: { fg: '#9a3412', bg: '#ffedd5' },
  PENDING:      { fg: '#1d4ed8', bg: '#dbeafe' },
  INITIATED:    { fg: '#374151', bg: '#f3f4f6' },
  EXPIRED:      { fg: '#6b21a8', bg: '#f3e8ff' },
};

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  const c = SESSION_STATUS_COLORS[status] ?? { fg: '#374151', bg: '#f3f4f6' };
  return (
    <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// Confidence pill — colour tracks how close it is to a pass.
export function ConfidencePill({ value }: { value?: number | null }) {
  if (value == null) return <span style={{ color: '#9ca3af' }}>—</span>;
  const c = value >= 85 ? { fg: '#15803d', bg: '#dcfce7' } : value >= 60 ? { fg: '#9a3412', bg: '#ffedd5' } : { fg: '#b91c1c', bg: '#fee2e2' };
  return (
    <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg }}>
      {value}%
    </span>
  );
}

// ── RBAC ──────────────────────────────────────────────────────────────────
// Reads the cached admin user and exposes a permission check to gate the
// sensitive KYC decisions/config. Server RBAC (finance.admin.kyc) remains
// authoritative — this is a UX gate only.
export const KYC_PERM = 'finance.admin.kyc';

export function useKycPermissions() {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setUser(JSON.parse(raw) as AuthUser);
    } catch { /* unauthenticated handled by route guard */ }
  }, []);
  const canManage = hasAnyPermission(user, [KYC_PERM]);
  return { user, canManage, permission: KYC_PERM };
}
