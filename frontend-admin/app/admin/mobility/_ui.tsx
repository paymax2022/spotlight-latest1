'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';
import { colors, tint } from '@/components/ui/vuexy';

// Shared presentational + RBAC helpers for the Mobility console. Matches the
// existing admin pages' light-card inline-style convention (see fx/_ui.tsx).

export const card = (): CSSProperties => ({ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card, boxShadow: '0 4px 18px rgba(47, 43, 61, .06)' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: `1px solid ${colors.inputBorder}`, background: colors.card, cursor: 'pointer', fontSize: '0.85rem', color: colors.text });
export const btnPrimary = (bg: string = colors.primary): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 });
export const btnDisabled = (): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: `1px solid ${colors.border}`, background: colors.headBg, color: colors.muted, cursor: 'not-allowed', fontSize: '0.85rem', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600 });
export const td = (): CSSProperties => ({ padding: '0.5rem 0.5rem', color: colors.text });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.5rem', borderRadius: '0.375rem', border: `1px solid ${colors.inputBorder}`, fontSize: '0.85rem', width: '100%' });

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  approved: { fg: colors.success, bg: tint(colors.success, 0.12) }, valid: { fg: colors.success, bg: tint(colors.success, 0.12) }, active: { fg: colors.success, bg: tint(colors.success, 0.12) }, completed: { fg: colors.success, bg: tint(colors.success, 0.12) }, resolved: { fg: colors.success, bg: tint(colors.success, 0.12) }, online: { fg: colors.success, bg: tint(colors.success, 0.12) }, in_progress: { fg: colors.success, bg: tint(colors.success, 0.12) }, pin_verified: { fg: colors.success, bg: tint(colors.success, 0.12) },
  submitted: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, under_review: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, pending: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, investigating: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, inactive: { fg: colors.muted, bg: tint(colors.muted, 0.12) }, requested: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, fare_negotiating: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, driver_assigned: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, driver_arriving: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, medium: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, low: { fg: colors.muted, bg: tint(colors.muted, 0.12) },
  rejected: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, suspended: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, expired: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, failed: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, open: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, escalated: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, cancelled: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, no_show: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, safety_hold: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, critical: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, high: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, disputed: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, refunded: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  // multi-modal statuses (parcel / bus / towing / movers / car-hire)
  delivered: { fg: colors.success, bg: tint(colors.success, 0.12) }, dropoff_verified: { fg: colors.success, bg: tint(colors.success, 0.12) }, completion_confirmed: { fg: colors.success, bg: tint(colors.success, 0.12) }, boarded: { fg: colors.success, bg: tint(colors.success, 0.12) }, issued: { fg: colors.success, bg: tint(colors.success, 0.12) }, released: { fg: colors.success, bg: tint(colors.success, 0.12) }, held: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  created: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, courier_assigned: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, pickup_pin_verified: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, picked_up: { fg: colors.success, bg: tint(colors.success, 0.12) }, in_transit: { fg: colors.success, bg: tint(colors.success, 0.12) },
  scheduled: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, boarding: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, departed: { fg: colors.success, bg: tint(colors.success, 0.12) }, booked: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  operator_accepted: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, operator_en_route: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  quote_requested: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, bids_received: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, bid_accepted: { fg: colors.success, bg: tint(colors.success, 0.12) }, crew_assigned: { fg: colors.success, bg: tint(colors.success, 0.12) },
  quoted: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, confirmed: { fg: colors.success, bg: tint(colors.success, 0.12) }, extended: { fg: colors.success, bg: tint(colors.success, 0.12) }, none: { fg: colors.muted, bg: tint(colors.muted, 0.12) },
  // business logistics + event transport statuses
  assigned: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, full: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, paid: { fg: colors.success, bg: tint(colors.success, 0.12) }, overdue: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, closed: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, draft: { fg: colors.muted, bg: tint(colors.muted, 0.12) },
};

export function Badge({ status, label }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status] ?? { fg: colors.text, bg: tint(colors.muted, 0.12) };
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, textTransform: 'capitalize' }}>{label ?? status.replace(/_/g, ' ')}</span>;
}

export function Kpi({ label, value, accent, sub, href }: { label: string; value: string; accent?: string; sub?: string; href?: string }) {
  const inner = (
    <div style={{ ...card(), padding: '0.9rem 1rem', borderLeft: `3px solid ${accent ?? colors.border}` }}>
      <div style={{ fontSize: '0.75rem', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: 4, color: colors.text }}>{value}</div>
      {sub ? <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: 2 }}>{sub}</div> : null}
      {href ? <div style={{ fontSize: '0.72rem', color: accent ?? colors.primary, marginTop: 2 }}>View →</div> : null}
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: 'none' }}>{inner}</Link> : inner;
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

// State helpers — loading / empty / error / restricted, used across every page.
export function StateNote({ kind, children }: PropsWithChildren<{ kind: 'loading' | 'empty' | 'error' | 'restricted' }>) {
  const color = kind === 'error' || kind === 'restricted' ? colors.danger : colors.muted;
  return <p style={{ color, fontSize: '0.9rem', margin: '1rem 0' }}>{children}</p>;
}

// A small banner reminding operators that the action they're viewing is
// role-gated and audited (sensitive ops: pricing, approvals, dispatch, safety).
export function AuditedNotice({ text }: { text: string }) {
  return (
    <div style={{ ...card(), background: tint(colors.info, 0.08), borderColor: tint(colors.info, 0.4), padding: '0.6rem 0.9rem', marginBottom: '1.25rem', fontSize: '0.8rem', color: colors.info }}>
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
    { href: '/admin/mobility/scheduled', label: 'Scheduled', key: 'scheduled' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: `1px solid ${colors.border}`, paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : colors.text, background: active === t.key ? colors.primary : colors.headBg }}>{t.label}</Link>
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
