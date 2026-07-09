'use client';

import Link from 'next/link';

// ── EdTech School-Fees admin console — shared tab strip ───────────────────────
// Re-uses the Academy design primitives from ../_ui (light cards, #340075 brand
// accent, Badge/Card/Kpi/etc). This file only adds the fees-specific tab strip;
// every fees page imports its primitives directly from '../../_ui'.

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
