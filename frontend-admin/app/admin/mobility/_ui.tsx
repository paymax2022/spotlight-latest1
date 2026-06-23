'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';

// Shared presentational + RBAC helpers for the Mobility console. Matches the
// existing admin pages' light-card inline-style convention (see fx/_ui.tsx).

export const card = (): CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (bg = '#1d4ed8'): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 });
export const btnDisabled = (): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: '1px solid #e5e7eb', background: '#f3f4f6', color: '#9ca3af', cursor: 'not-allowed', fontSize: '0.85rem', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600 });
export const td = (): CSSProperties => ({ padding: '0.5rem 0.5rem', color: '#374151' });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.5rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.85rem', width: '100%' });

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  approved: { fg: '#15803d', bg: '#dcfce7' }, valid: { fg: '#15803d', bg: '#dcfce7' }, active: { fg: '#15803d', bg: '#dcfce7' }, completed: { fg: '#15803d', bg: '#dcfce7' }, resolved: { fg: '#15803d', bg: '#dcfce7' }, online: { fg: '#15803d', bg: '#dcfce7' }, in_progress: { fg: '#15803d', bg: '#dcfce7' }, pin_verified: { fg: '#15803d', bg: '#dcfce7' },
  submitted: { fg: '#9a3412', bg: '#ffedd5' }, under_review: { fg: '#9a3412', bg: '#ffedd5' }, pending: { fg: '#9a3412', bg: '#ffedd5' }, investigating: { fg: '#9a3412', bg: '#ffedd5' }, inactive: { fg: '#6b7280', bg: '#f3f4f6' }, requested: { fg: '#9a3412', bg: '#ffedd5' }, fare_negotiating: { fg: '#9a3412', bg: '#ffedd5' }, driver_assigned: { fg: '#9a3412', bg: '#ffedd5' }, driver_arriving: { fg: '#9a3412', bg: '#ffedd5' }, medium: { fg: '#9a3412', bg: '#ffedd5' }, low: { fg: '#6b7280', bg: '#f3f4f6' },
  rejected: { fg: '#b91c1c', bg: '#fee2e2' }, suspended: { fg: '#b91c1c', bg: '#fee2e2' }, expired: { fg: '#b91c1c', bg: '#fee2e2' }, failed: { fg: '#b91c1c', bg: '#fee2e2' }, open: { fg: '#b91c1c', bg: '#fee2e2' }, escalated: { fg: '#b91c1c', bg: '#fee2e2' }, cancelled: { fg: '#b91c1c', bg: '#fee2e2' }, no_show: { fg: '#b91c1c', bg: '#fee2e2' }, safety_hold: { fg: '#b91c1c', bg: '#fee2e2' }, critical: { fg: '#b91c1c', bg: '#fee2e2' }, high: { fg: '#b91c1c', bg: '#fee2e2' }, disputed: { fg: '#b91c1c', bg: '#fee2e2' }, refunded: { fg: '#b91c1c', bg: '#fee2e2' },
  // multi-modal statuses (parcel / bus / towing / movers / car-hire)
  delivered: { fg: '#15803d', bg: '#dcfce7' }, dropoff_verified: { fg: '#15803d', bg: '#dcfce7' }, completion_confirmed: { fg: '#15803d', bg: '#dcfce7' }, boarded: { fg: '#15803d', bg: '#dcfce7' }, issued: { fg: '#15803d', bg: '#dcfce7' }, released: { fg: '#15803d', bg: '#dcfce7' }, held: { fg: '#9a3412', bg: '#ffedd5' },
  created: { fg: '#9a3412', bg: '#ffedd5' }, courier_assigned: { fg: '#9a3412', bg: '#ffedd5' }, pickup_pin_verified: { fg: '#9a3412', bg: '#ffedd5' }, picked_up: { fg: '#15803d', bg: '#dcfce7' }, in_transit: { fg: '#15803d', bg: '#dcfce7' },
  scheduled: { fg: '#9a3412', bg: '#ffedd5' }, boarding: { fg: '#9a3412', bg: '#ffedd5' }, departed: { fg: '#15803d', bg: '#dcfce7' }, booked: { fg: '#9a3412', bg: '#ffedd5' },
  operator_accepted: { fg: '#9a3412', bg: '#ffedd5' }, operator_en_route: { fg: '#9a3412', bg: '#ffedd5' },
  quote_requested: { fg: '#9a3412', bg: '#ffedd5' }, bids_received: { fg: '#9a3412', bg: '#ffedd5' }, bid_accepted: { fg: '#15803d', bg: '#dcfce7' }, crew_assigned: { fg: '#15803d', bg: '#dcfce7' },
  quoted: { fg: '#9a3412', bg: '#ffedd5' }, confirmed: { fg: '#15803d', bg: '#dcfce7' }, extended: { fg: '#15803d', bg: '#dcfce7' }, none: { fg: '#6b7280', bg: '#f3f4f6' },
  // business logistics + event transport statuses
  assigned: { fg: '#9a3412', bg: '#ffedd5' }, full: { fg: '#b91c1c', bg: '#fee2e2' }, paid: { fg: '#15803d', bg: '#dcfce7' }, overdue: { fg: '#b91c1c', bg: '#fee2e2' }, closed: { fg: '#b91c1c', bg: '#fee2e2' }, draft: { fg: '#6b7280', bg: '#f3f4f6' },
};

export function Badge({ status, label }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status] ?? { fg: '#374151', bg: '#f3f4f6' };
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, textTransform: 'capitalize' }}>{label ?? status.replace(/_/g, ' ')}</span>;
}

export function Kpi({ label, value, accent, sub, href }: { label: string; value: string; accent?: string; sub?: string; href?: string }) {
  const inner = (
    <div style={{ ...card(), padding: '0.9rem 1rem', borderLeft: `3px solid ${accent ?? '#e5e7eb'}` }}>
      <div style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: 4, color: '#111827' }}>{value}</div>
      {sub ? <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 2 }}>{sub}</div> : null}
      {href ? <div style={{ fontSize: '0.72rem', color: accent ?? '#1d4ed8', marginTop: 2 }}>View →</div> : null}
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: 'none' }}>{inner}</Link> : inner;
}

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

// State helpers — loading / empty / error / restricted, used across every page.
export function StateNote({ kind, children }: PropsWithChildren<{ kind: 'loading' | 'empty' | 'error' | 'restricted' }>) {
  const color = kind === 'error' || kind === 'restricted' ? '#dc2626' : '#6b7280';
  return <p style={{ color, fontSize: '0.9rem', margin: '1rem 0' }}>{children}</p>;
}

// A small banner reminding operators that the action they're viewing is
// role-gated and audited (sensitive ops: pricing, approvals, dispatch, safety).
export function AuditedNotice({ text }: { text: string }) {
  return (
    <div style={{ ...card(), background: '#eff6ff', borderColor: '#bfdbfe', padding: '0.6rem 0.9rem', marginBottom: '1.25rem', fontSize: '0.8rem', color: '#1e40af' }}>
      🔒 {text} Every change is role-gated (RBAC) and written to the transport audit log.
    </div>
  );
}

export function MobilityTabs({ active }: { active: string }) {
  const tabs = [
    { href: '/admin/mobility', label: 'Dashboard', key: 'dashboard' },
    { href: '/admin/mobility/drivers', label: 'Drivers', key: 'drivers' },
    { href: '/admin/mobility/vehicles', label: 'Vehicles', key: 'vehicles' },
    { href: '/admin/mobility/dispatch', label: 'Dispatch', key: 'dispatch' },
    { href: '/admin/mobility/pricing', label: 'Pricing & Commission', key: 'pricing' },
    { href: '/admin/mobility/safety', label: 'Safety Center', key: 'safety' },
    { href: '/admin/mobility/reports', label: 'Reports', key: 'reports' },
    { href: '/admin/mobility/parcels', label: 'Parcels', key: 'parcels' },
    { href: '/admin/mobility/bus', label: 'Bus', key: 'bus' },
    { href: '/admin/mobility/towing', label: 'Towing', key: 'towing' },
    { href: '/admin/mobility/movers', label: 'Movers', key: 'movers' },
    { href: '/admin/mobility/car-hire', label: 'Car Hire', key: 'car-hire' },
    { href: '/admin/mobility/business', label: 'Business', key: 'business' },
    { href: '/admin/mobility/events', label: 'Events', key: 'events' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : '#374151', background: active === t.key ? '#1d4ed8' : '#f3f4f6' }}>{t.label}</Link>
      ))}
    </div>
  );
}

// Money: integer kobo → display.
export function naira(kobo: number): string {
  const n = kobo / 100;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `₦${(n / 1_000).toFixed(1)}K`;
  return `₦${n.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}
export function nairaFull(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── RBAC helper ──────────────────────────────────────────────────────────────
// Reads the cached admin user (same source as AdminSidebar / AdminRouteGuard)
// and exposes a permission check so pages can disable sensitive affordances.
// Server still enforces — this only prevents dead-end UI.
export function useMobilityPermissions() {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setUser(JSON.parse(raw) as AuthUser);
    } catch { /* unauthenticated handled by route guard */ }
  }, []);
  const can = (perms: string[]) => hasAnyPermission(user, perms);
  return { user, can };
}

// Permission keys for the mobility module (kept here + in routeGuard).
export const MOBILITY_PERMS = {
  view: ['mobility.view'],
  driversManage: ['mobility.drivers.manage'],
  vehiclesManage: ['mobility.vehicles.manage'],
  dispatchManage: ['mobility.dispatch.manage'],
  pricingManage: ['mobility.pricing.manage'],
  safetyManage: ['mobility.safety.manage'],
  // multi-modal expansion (parcel / bus / towing / movers / car-hire)
  parcelsManage: ['mobility.parcels.manage'],
  busManage: ['mobility.bus.manage'],
  towingManage: ['mobility.towing.manage'],
  moversManage: ['mobility.movers.manage'],
  carHireManage: ['mobility.car_hire.manage'],
  businessManage: ['mobility.business.manage'],
  eventsManage: ['mobility.events.manage'],
};
