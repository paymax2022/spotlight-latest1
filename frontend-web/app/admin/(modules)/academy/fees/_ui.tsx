'use client';

import Link from 'next/link';
import { useEffect, useState, type PropsWithChildren } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';

// ── EdTech School-Fees admin console — shared tab strip + per-page guard ───────
// Re-uses the Academy design primitives from ../_ui (light cards, #340075 brand
// accent, Badge/Card/Kpi/etc). This file adds the fees-specific tab strip plus
// FeesGuard, the per-page RBAC assertion; every fees page imports its primitives
// directly from '../../_ui'.

type Tab = { href: string; label: string; key: string };

// Fees sub-console tab strip (SC-29 … SC-40).
export function FeesTabs({ active }: { active: string }) {
  const tabs: Tab[] = [
    { href: '/admin/academy/fees/setup-wizard', label: 'Setup Wizard', key: 'setup-wizard' },
    { href: '/admin/academy/fees/onboarding', label: 'Bulk Onboarding', key: 'onboarding' },
    { href: '/admin/academy/fees/collections', label: 'Collections', key: 'collections' },
    { href: '/admin/academy/fees/hardship', label: 'Hardship Queue', key: 'hardship' },
    { href: '/admin/academy/fees/promotion', label: 'Promotion & Rollover', key: 'promotion' },
    { href: '/admin/academy/fees/competition', label: 'Competitions', key: 'competition' },
    { href: '/admin/academy/fees/gov-export', label: 'Gov Export', key: 'gov-export' },
    { href: '/admin/academy/fees/roles', label: 'Roles', key: 'roles' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : '#374151', background: active === t.key ? '#340075' : '#f3f4f6' }}>{t.label}</Link>
      ))}
    </div>
  );
}

// ── FeesGuard — per-page RBAC assertion (school-admin surface) ────────────────
// Mirrors the platform console's PlatformGuard, but the required capability is
// passed in via the `permission` prop because each fees module has a different
// enforced slug (academy.fees.setup, academy.fees.hardship.review, …). Reads the
// same admin session everything else uses (localStorage 'spotlight_admin_user')
// and renders children ONLY if the session carries the required permission. A
// school role that lacks it — or that deep-links a URL — sees the denial panel,
// never the data. Defence in depth on the client; the Go backend
// (middleware.RequirePermission) stays authoritative.
export function FeesGuard({ permission, children }: PropsWithChildren<{ permission: string }>) {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setAuthUser(JSON.parse(raw) as AuthUser);
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);

  const allowed = hasAnyPermission(authUser, [permission]);

  if (loaded && !allowed) {
    return (
      <div style={{ padding: '2rem 0.5rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, margin: 0 }}>School Fees Console</h1>
        <div style={{ marginTop: '1rem', border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', borderRadius: '0.5rem', padding: '1rem 1.25rem', maxWidth: 720 }}>
          <strong>Access denied.</strong> This module requires the{' '}
          <code>{permission}</code> permission. Your current admin session does not carry it, so the
          fees data on this page is not visible to you. Ask a school owner or platform administrator
          to grant the appropriate school-scoped role.
        </div>
      </div>
    );
  }
  if (!loaded) return <p style={{ color: '#6b7280', padding: '1rem' }}>Loading…</p>;
  return <>{children}</>;
}
