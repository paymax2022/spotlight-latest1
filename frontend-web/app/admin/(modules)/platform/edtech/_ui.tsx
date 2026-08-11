'use client';

// ── Shared UI for the Platform SUPER-ADMIN EdTech console (SU-01..SU-12) ──────
//
// Design system is REUSED, not reinvented: the presentational primitives
// (PageHeader, Card, Kpi, Badge, StateBlock, DisclosureNote, AuditNote, Bar,
// btn*, th/td/input/label/select, formatNaira, fmtDate) come straight from the
// Academy console's _ui.tsx (../../academy/_ui). This file only adds the two
// things unique to the platform surface: PlatformTabs (its own tab strip,
// SEPARATE from AcademyTabs) and PlatformGuard (the per-page RBAC assertion).
//
// ── Checkpoint E — RBAC scope separation (READ THIS) ──────────────────────────
// This console is gated on the SINGLE platform-operator capability
// `platform_edtech_admin`. It is NOT reachable by any school-level role
// (school_owner / bursar / class_teacher / head_teacher / guardian / student).
//   • Nav: the "Platform · EdTech" section in AdminSidebar.tsx lists every route
//     with permissions:['platform_edtech_admin']; hasAnyPermission() filters the
//     whole section out for anyone lacking it — a bursar sees nothing.
//   • Page: PlatformGuard below RE-ASSERTS the same capability on every page, so
//     a school role that guesses/deep-links a URL is shown "access denied", never
//     the data. Defence in depth on the client; the Go backend
//     (middleware.RequirePermission "platform_edtech_admin") stays authoritative.
// A school role having this capability would be a mis-grant, not an escalation
// path — there is no "school-admin → super-admin" bridge anywhere in this code.

import Link from 'next/link';
import { useEffect, useState, type PropsWithChildren, type ReactNode } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';
import { PageHeader as AcademyPageHeader } from '../../academy/_ui';

// The one capability that unlocks this entire surface.
export const PLATFORM_EDTECH_PERMISSION = 'platform_edtech_admin';

// Re-export the Academy design-system primitives so pages import from one place.
export {
  card, btn, btnPrimary, btnDanger, th, td, input, label, select,
  Badge, PageHeader, Card, Kpi, StateBlock, DisclosureNote, AuditNote,
  FilterBar, Bar, timeAgo, fmtDate, pct, formatNaira,
} from '../../academy/_ui';

// ── Platform console tab strip (SEPARATE from AcademyTabs) ────────────────────
type Tab = { href: string; label: string; key: string };
const TABS: Tab[] = [
  { href: '/admin/platform/edtech', label: 'Directory (SU-01)', key: 'directory' },
  { href: '/admin/platform/edtech/verification', label: 'Verification (SU-02)', key: 'verification' },
  { href: '/admin/platform/edtech/collections', label: 'Collections (SU-03)', key: 'collections' },
  { href: '/admin/platform/edtech/fraud', label: 'Fraud & Risk (SU-04)', key: 'fraud' },
  { href: '/admin/platform/edtech/gov-sync', label: 'Gov Sync (SU-05)', key: 'gov-sync' },
  { href: '/admin/platform/edtech/competitions', label: 'Competitions (SU-06)', key: 'competitions' },
  { href: '/admin/platform/edtech/trust-scores', label: 'Trust Score (SU-07)', key: 'trust-scores' },
  { href: '/admin/platform/edtech/scholarships', label: 'Scholarships (SU-08)', key: 'scholarships' },
  { href: '/admin/platform/edtech/support', label: 'Support (SU-09)', key: 'support' },
  { href: '/admin/platform/edtech/flags', label: 'Flags & Config (SU-10)', key: 'flags' },
  { href: '/admin/platform/edtech/audit-log', label: 'Audit Log (SU-11)', key: 'audit-log' },
  { href: '/admin/platform/edtech/compliance', label: 'Compliance (SU-12)', key: 'compliance' },
];

export function PlatformTabs({ active }: { active: string }) {
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem' }}>
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.82rem', fontWeight: 600, color: active === t.key ? '#fff' : '#374151', background: active === t.key ? '#340075' : '#f3f4f6' }}>{t.label}</Link>
      ))}
    </div>
  );
}

// ── PlatformGuard — per-page RBAC assertion (Checkpoint E, page layer) ────────
// Reads the same admin session used everywhere (localStorage 'spotlight_admin_user',
// the store the existing AdminSidebar + voting/visibility page already read) and
// renders children ONLY if the session carries `platform_edtech_admin`. A school
// owner/bursar session lacks it → they see the denial panel, never the data.
export function PlatformGuard({ children }: PropsWithChildren) {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setAuthUser(JSON.parse(raw) as AuthUser);
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);

  const allowed = hasAnyPermission(authUser, [PLATFORM_EDTECH_PERMISSION]);

  if (loaded && !allowed) {
    return (
      <div style={{ padding: '2rem 0.5rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, margin: 0 }}>Platform EdTech Console</h1>
        <div style={{ marginTop: '1rem', border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', borderRadius: '0.5rem', padding: '1rem 1.25rem', maxWidth: 720 }}>
          <strong>Access denied.</strong> This is a Paymax platform-operator surface. It requires the{' '}
          <code>platform_edtech_admin</code> capability, which is entirely separate from any school-level
          role. A school owner, bursar, or teacher has zero visibility here regardless of their
          school-scoped permissions.
        </div>
      </div>
    );
  }
  if (!loaded) return <p style={{ color: '#6b7280', padding: '1rem' }}>Loading…</p>;
  return <>{children}</>;
}

// A small standard page shell for every SU- module: guard + header + tabs.
export function PlatformPage({ active, title, subtitle, action, children }: PropsWithChildren<{ active: string; title: string; subtitle?: string; action?: ReactNode }>) {
  return (
    <PlatformGuard>
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <AcademyPageHeader title={title} subtitle={subtitle} action={action} />
        <PlatformTabs active={active} />
        {children}
      </div>
    </PlatformGuard>
  );
}
