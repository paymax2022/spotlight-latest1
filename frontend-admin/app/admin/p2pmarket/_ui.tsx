'use client';

// P2P Marketplace ops console shares the savings/_ui light-card primitives and adds
// the module-local tab bar.
import Link from 'next/link';
import { colors } from '@/components/ui/vuexy';

export {
  card, btn, btnPrimary, btnDanger, th, td, input, label, select,
  Badge, PageHeader, Card, Kpi, StateBlock, DisclosureNote, AuditNote, FilterBar,
  timeAgo, fmtDate, pct,
} from '../savings/_ui';

type Tab = { href: string; label: string; key: string };

export function P2PMarketTabs({ active }: { active: string }) {
  const tabs: Tab[] = [
    { href: '/admin/p2pmarket/dashboard', label: 'Overview', key: 'overview' },
    { href: '/admin/p2pmarket/listings', label: 'Listings', key: 'listings' },
    { href: '/admin/p2pmarket/orders', label: 'Orders', key: 'orders' },
    { href: '/admin/p2pmarket/disputes', label: 'Disputes', key: 'disputes' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: `1px solid ${colors.border}`, paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : colors.text, background: active === t.key ? colors.primary : colors.bg }}>{t.label}</Link>
      ))}
    </div>
  );
}
