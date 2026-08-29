'use client';

// Groups ops console shares the savings/_ui light-card primitives and adds the
// module-local tab bar.
import Link from 'next/link';
import { colors } from '@/components/ui/vuexy';
import { DisclosureNote as BaseDisclosureNote } from '../savings/_ui';
import { GROUPS_ADMIN_IS_MOCK } from '@/services/groupsAdminService';

export {
  card, btn, btnPrimary, btnDanger, th, td, input, label, select,
  Badge, PageHeader, Card, Kpi, StateBlock, DisclosureNote, AuditNote, FilterBar,
  timeAgo, fmtDate, pct,
} from '../savings/_ui';

/**
 * Says out loud that this console is showing fixtures.
 *
 * The defect this closes: /admin/groups/dashboard and /admin/groups/groups have
 * ALWAYS rendered hardcoded sample rows ("Lagos Foodies Pool", a ₦1.8bn pooled
 * balance) with nothing on screen to distinguish them from production figures,
 * because there is no groups admin route group in the Go backend to read from.
 * An operator cannot tell a fabricated balance from a real one by looking at it,
 * so the page has to tell them. Renders nothing at all once a real backend
 * lands and the flag goes live.
 */
export function SampleDataBanner() {
  if (!GROUPS_ADMIN_IS_MOCK) return null;
  return (
    <BaseDisclosureNote>
      <strong>⚠ SAMPLE DATA — not real.</strong> Every figure on this page is a hardcoded fixture. The groups module has
      <strong> no admin API</strong> in the backend yet (only member endpoints exist under <code>/api/finance/groups</code>),
      so there is nothing to read. Do not use these numbers for reconciliation, reporting or any decision.
      {' '}Looking for association members, dues or approvals? Those are a <strong>different module</strong> and are live:{' '}
      <Link href="/admin/association/organisations" style={{ color: colors.primary, fontWeight: 700 }}>Associations register →</Link>
    </BaseDisclosureNote>
  );
}

type Tab = { href: string; label: string; key: string };

export function GroupsTabs({ active }: { active: string }) {
  const tabs: Tab[] = [
    { href: '/admin/groups/dashboard', label: 'Overview', key: 'overview' },
    { href: '/admin/groups/groups', label: 'Groups & members', key: 'groups' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: `1px solid ${colors.border}`, paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : colors.text, background: active === t.key ? colors.primary : colors.bg }}>{t.label}</Link>
      ))}
    </div>
  );
}
