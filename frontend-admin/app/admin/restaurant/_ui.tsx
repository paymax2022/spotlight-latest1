'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';

// RBAC permission slugs for the restaurant ops console.
// `manage`/`pricing` already exist server-side (restaurant.manage,
// restaurant.admin.pricing). The dispatch/onboarding/payouts/disputes slugs are
// the proposed slugs the backend admin routes should guard with (see service
// header + orchestrator report). Pages disable mutating affordances when the
// cached admin user lacks the slug; the server remains authoritative.
export const RESTAURANT_PERMS = {
  manage: ['restaurant.manage'],
  pricing: ['restaurant.admin.pricing'],
  dispatch: ['restaurant.admin.dispatch', 'restaurant.manage'],
  onboarding: ['restaurant.admin.onboarding', 'restaurant.manage'],
  payouts: ['restaurant.admin.payouts'],
  disputes: ['restaurant.admin.disputes', 'restaurant.manage'],
};

// Reads the cached admin user (same source as AdminSidebar / route guard) and
// exposes a permission check. Mirrors useDeliveryFeePermissions /
// useMobilityPermissions. Server RBAC stays authoritative — this only prevents
// dead-end UI.
export function useRestaurantPermissions() {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setUser(JSON.parse(raw) as AuthUser);
    } catch {
      /* unauthenticated handled by route guard */
    }
  }, []);
  const can = (perms: string[]) => hasAnyPermission(user, perms);
  return { user, can };
}

// Renders a "you lack permission X" banner and blocks the page body when the
// user cannot even view the surface.
export function AccessNotice({ perm }: { perm: string }) {
  return (
    <div style={{ ...card(), borderColor: '#fca5a5', background: '#fef2f2', color: '#991b1b' }}>
      <strong>Insufficient permission.</strong>{' '}
      <span style={{ fontSize: '0.85rem' }}>
        This surface requires the <code>{perm}</code> RBAC permission. Contact an administrator. The
        server enforces this independently.
      </span>
    </div>
  );
}

export const card = (): CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: '#6b7280', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.02em' });
export const td = (): CSSProperties => ({ padding: '0.5rem 0.5rem', color: '#374151', borderTop: '1px solid #f3f4f6' });

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  placed: { bg: '#e0e7ff', fg: '#3730a3' },
  accepted: { bg: '#e0e7ff', fg: '#3730a3' },
  preparing: { bg: '#fef3c7', fg: '#92400e' },
  ready: { bg: '#fef3c7', fg: '#92400e' },
  assigned: { bg: '#cffafe', fg: '#155e75' },
  picked_up: { bg: '#cffafe', fg: '#155e75' },
  delivered: { bg: '#dcfce7', fg: '#166534' },
  cancelled: { bg: '#f3f4f6', fg: '#374151' },
  refunded: { bg: '#f3f4f6', fg: '#374151' },
  no_rider: { bg: '#fee2e2', fg: '#991b1b' },
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

// Naira from kobo (integer minor units).
export function naira(kobo: number): string {
  return `₦${(((kobo ?? 0) / 100)).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
