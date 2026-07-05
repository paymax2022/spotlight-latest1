'use client';

// Spray ops console shares the savings/_ui light-card primitives and adds the
// module-local tab bar.
import Link from 'next/link';

export {
  card, btn, btnPrimary, btnDanger, th, td, input, label, select,
  Badge, PageHeader, Card, Kpi, StateBlock, DisclosureNote, AuditNote, FilterBar,
  timeAgo, fmtDate, pct,
} from '../savings/_ui';

type Tab = { href: string; label: string; key: string };

export function SprayTabs({ active }: { active: string }) {
  const tabs: Tab[] = [
    { href: '/admin/spray/dashboard', label: 'Overview', key: 'overview' },
    { href: '/admin/spray/events', label: 'Events', key: 'events' },
    { href: '/admin/spray/payouts', label: 'Payouts', key: 'payouts' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : '#374151', background: active === t.key ? '#340075' : '#f3f4f6' }}>{t.label}</Link>
      ))}
    </div>
  );
}
